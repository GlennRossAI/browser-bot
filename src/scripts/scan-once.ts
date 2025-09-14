#!/usr/bin/env tsx
/**
 * Headless scan of Fundly: add most recent to pipeline (if possible),
 * open first pipeline lead, extract fields, persist, and send email if
 * it's a new lead from today and passes filters.
 *
 * Usage: tsx src/scripts/scan-once.ts
 */
import 'dotenv/config';
import { chromium } from 'playwright';
import { insertLead, updateEmailSentAt, emailAlreadySent, canContactByEmail } from '../database/queries/leads.js';
import { startRun, finishRun } from '../database/queries/run_logs.js';
import { FundlyLeadInsert } from '../types/lead.js';
import { passesRequirements } from '../filters/threshold.js';
import { sendLeadEmail } from '../email/send.js';
import { closePool } from '../database/utils/connection.js';
import { logMsg, logVar, logError } from '../utils/logger.js';

function isTodayIso(iso?: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return d.getUTCFullYear() === now.getUTCFullYear() && d.getUTCMonth() === now.getUTCMonth() && d.getUTCDate() === now.getUTCDate();
}

async function runOnce() {
  const run = await startRun({ script: 'scan-once', version: '1.0.0' });
  logMsg('Run started', { runId: run.id });
  let discovered = 0;
  let saved = 0;
  let emailed = 0;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    const FUNDLY_EMAIL = process.env.FUNDLY_EMAIL || process.env.FUNDLY_USER_EMAIL || '';
    const FUNDLY_PASSWORD = process.env.FUNDLY_PASSWORD || process.env.FUNDLY_USER_PASS || '';
    if (!FUNDLY_EMAIL || !FUNDLY_PASSWORD) {
      throw new Error('Missing FUNDLY_EMAIL/FUNDLY_PASSWORD');
    }
    logVar('env.ready', { hasEmail: !!FUNDLY_EMAIL, hasPass: !!FUNDLY_PASSWORD, hasDb: !!process.env.DATABASE_URL });

    // Login
    await page.goto('https://app.getfundly.com/login?redirectTo=/c/business');
    await page.getByRole('textbox', { name: 'Email' }).fill(FUNDLY_EMAIL);
    await page.getByRole('textbox', { name: 'Email' }).press('Enter');
    await page.getByRole('textbox', { name: 'Password' }).fill(FUNDLY_PASSWORD);
    await page.getByRole('button', { name: 'Login' }).click();
    await page.waitForURL(/\/c\/business(\b|\/|\?|$)/, { timeout: 15000 });
    await page.waitForSelector('text="Realtime Lead Timeline"', { timeout: 10000 }).catch(() => {});
    logMsg('Signed in and on dashboard');

    // Try to add the newest to pipeline
    const addButtons = await page.$$('button[label="Add to My Pipeline"], button:has-text("Add to My Pipeline")');
    logVar('feed.addButtons.count', addButtons.length);
    if (addButtons.length > 0) {
      try {
        const containerHandle = await addButtons[0].evaluateHandle((btn) => (btn as HTMLElement).closest('div[id]'));
        const possibleId = await (containerHandle as any).evaluate((el: HTMLElement | null) => el?.id || null);
        logVar('feed.candidateLeadId', possibleId);
        await addButtons[0].click();
        await page.waitForTimeout(1500);
      } catch (e) { logError(e, { step: 'click-add' }); }
    }

    // Go to pipeline and pick first lead
    await page.getByRole('link', { name: 'My Pipeline' }).click();
    await page.waitForTimeout(2000);
    let leadId: string | null = null;
    const ids = await page.$$eval('div[id]', els => els.map(el => (el as HTMLElement).id).filter(Boolean));
    const candidates = ids.filter(id => id && id.toLowerCase() !== 'root' && !id.startsWith('tabs-') && !id.startsWith('menu-') && !id.startsWith('menu-list-'));
    const numeric = candidates.filter(id => /^\d+$/.test(id));
    const filtered = numeric.length ? numeric : candidates;
    if (filtered.length) leadId = filtered[0];
    logVar('pipeline.ids', filtered.slice(0, 10));
    if (!leadId) throw new Error('No pipeline leads visible');
    discovered = 1;

    await page.locator(`div[id="${leadId}"]`).first().click();
    await page.waitForTimeout(800);

    // Reveal contact if needed
    try {
      await page.getByRole('button', { name: /Reveal/i }).click({ timeout: 3000 });
      logMsg('Revealed contact info');
    } catch { logMsg('No Reveal needed'); }

    const contactTab = page.locator('[role="tabpanel"][aria-labelledby*="tab-0"]');
    const emailRaw = (await contactTab.locator('p:text-is("Email") + p').textContent().catch(() => '')) || '';
    const phoneRaw = (await contactTab.locator('p:text-is("Phone") + p').textContent().catch(() => '')) || '';
    logVar('contact.raw', { emailRaw, phoneRaw });

    // Expand background
    try { await page.getByText('Show more').click({ timeout: 2000 }); } catch {}
    const backgroundInfo = ((await page.locator('p:text-is("Background Info") + p').textContent().catch(() => '')) || '').replace(/Show less$/i, '').trim();
    logVar('background.len', backgroundInfo.length);

    const getFieldValue = async (label: string) => {
      try { return (await page.locator(`p:text-is("${label}") + p`).textContent())?.trim() || ''; } catch { return ''; }
    };

    // Build lead payload
    const leadData: FundlyLeadInsert = {
      fundly_id: leadId,
      email: emailRaw.trim(),
      phone: phoneRaw.trim(),
      background_info: backgroundInfo,
      email_sent_at: null,
      created_at: new Date().toISOString().replace('Z', '+00:00'),
      can_contact: true,
      use_of_funds: await getFieldValue('Use of Funds'),
      location: await getFieldValue('Location'),
      urgency: await getFieldValue('Urgency'),
      time_in_business: await getFieldValue('Time in Business'),
      bank_account: await getFieldValue('Bank Account'),
      annual_revenue: await getFieldValue('Annual Revenue'),
      industry: await getFieldValue('Industry'),
      looking_for_min: '',
      looking_for_max: ''
    };

    // Parse looking_for range from background text
    if (/How much they are looking for:\s*\$[0-9,]+\s*-\s*\$[0-9,]+/.test(backgroundInfo)) {
      const m = backgroundInfo.match(/How much they are looking for:\s*\$([0-9,]+)\s*-\s*\$([0-9,]+)/);
      if (m) { leadData.looking_for_min = `$${m[1]}`; leadData.looking_for_max = `$${m[2]}`; }
    }

    const savedLead = await insertLead(leadData); // upsert by email
    saved = 1;
    logVar('db.savedLead', { id: savedLead.id, email: savedLead.email, fundly_id: (savedLead as any).fundly_id });

    // Decision: new today + passes requirements + not emailed yet + allowed to contact
    const newToday = isTodayIso(savedLead.created_at);
    const thresholdOk = passesRequirements(savedLead);
    const already = await emailAlreadySent(savedLead.email);
    const allowed = await canContactByEmail(savedLead.email);
    const shouldEmail = newToday && thresholdOk && !already && allowed;

    if (shouldEmail) {
      const res = await sendLeadEmail({ to: savedLead.email }).catch(() => null);
      if (res && !(res as any).skipped) {
        await updateEmailSentAt(savedLead.email, new Date());
        emailed = 1;
        logMsg('Email sent', { to: savedLead.email });
      }
    }

    await finishRun(run.id, { status: 'success', discovered_count: discovered, saved_count: saved, emailed_count: emailed });
    logMsg('Run finished', { runId: run.id, discovered, saved, emailed });
  } catch (error) {
    const msg = (error as Error)?.message || String(error);
    logError(error);
    await finishRun(run.id, { status: 'failure', discovered_count: discovered, saved_count: saved, emailed_count: emailed, error_message: msg });
    throw error;
  } finally {
    await browser.close();
    await closePool();
  }
}

try {
  const { pathToFileURL } = await import('url');
  const invoked = pathToFileURL(process.argv[1]).href;
  if (import.meta.url === invoked) {
    runOnce().catch((e) => { console.error(e); process.exit(1); });
  }
} catch {
  // Older Node or unusual env; just run
  runOnce().catch((e) => { console.error(e); process.exit(1); });
}
