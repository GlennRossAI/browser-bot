#!/usr/bin/env tsx
import 'dotenv/config';
import { chromium, Page } from 'playwright';
import { emailSendingEnabled, DRY_RUN } from '../config.js';
import { evaluatePrograms } from '../filters/threshold.js';
import { insertLead, updateEmailSentAt, emailAlreadySent, canContactByEmail } from '../database/queries/leads.js';
import { getLeadByFundlyId } from '../database/queries/leads.js';
import { FundlyLeadInsert } from '../types/lead.js';
import { sendLeadEmail } from '../email/send.js';
import { closePool } from '../database/utils/connection.js';
import { logMsg, logVar, logError } from '../utils/logger.js';
import { sanitizeEmail } from '../utils/email_utils.js';
import { normalizeUrgency, parseTibMonths, parseRevenueRange, normalizeUseOfFunds, normalizeBankAccount } from '../utils/normalize.js';

async function extractLeadFromPipeline(page: Page, leadId: string) {
  await page.locator(`div[id="${leadId}"]`).first().click();
  await page.waitForTimeout(600);

  // Exclusivity detection
  let isExclusive = false;
  try { if (await page.locator('h2:has-text("Exclusive with Others")').count()) isExclusive = true; } catch {}
  if (!isExclusive) { try { const btn = page.getByRole('button', { name: /Reveal/i }); if (await btn.count()) isExclusive = await btn.isDisabled().catch(() => false); } catch {} }
  if (!isExclusive) { try { if (await page.locator('p:has-text("exclusively working with another agent")').count()) isExclusive = true; } catch {} }
  logVar('contact.exclusive', isExclusive);

  // Contact details
  let emailRaw = '';
  let phoneRaw = '';
  try { emailRaw = (await page.locator('p:text-is("Email") + p').first().textContent()) || ''; } catch {}
  try { phoneRaw = (await page.locator('p:text-is("Phone") + p').first().textContent()) || ''; } catch {}
  if (!emailRaw) {
    try { const href = await page.locator('a[href^="mailto:"]').first().getAttribute('href'); if (href) emailRaw = href.replace(/^mailto:/i, '').split('?')[0]; } catch {}
  }
  const emailSanitized = sanitizeEmail(emailRaw) || '';

  // Name
  let nameRaw = '';
  try { nameRaw = (await page.locator('p:text-is("Name") + p').first().textContent()) || ''; } catch {}
  if (!nameRaw) { try { nameRaw = (await page.locator('p:text-is("Full Name") + p').first().textContent()) || ''; } catch {} }
  function cleanName(n: string): string { return (n || '').replace(/[\n\r]+/g, ' ').replace(/\s{2,}/g, ' ').trim(); }
  nameRaw = cleanName(nameRaw) || 'LOCKED';

  // Background
  try { await page.getByText('Show more').click({ timeout: 1500 }); } catch {}
  const backgroundInfo = ((await page.locator('p:text-is("Background Info") + p').textContent().catch(() => '')) || '').replace(/Show less$/i, '').trim();

  async function getField(label: string): Promise<string> {
    try { const t = await page.locator(`p:text-is("${label}") + p`).textContent(); if (t && t.trim()) return t.trim(); } catch {}
    try {
      const contactPanel = page.locator('[role="tabpanel"][aria-labelledby*="tab-0"]');
      const pairs = await contactPanel.locator('p').evaluateAll((nodes: Element[]) => {
        const out: Array<{ label: string; value: string }> = [];
        for (const el of nodes) {
          const lbl = (el.textContent || '').trim();
          const val = ((el.nextElementSibling as HTMLElement | null)?.textContent || '').trim();
          if (lbl) out.push({ label: lbl, value: val });
        }
        return out;
      }) as Array<{ label: string; value: string }>;
      const hit = pairs.find(p => p.label.toLowerCase() === label.toLowerCase());
      if (hit && hit.value) return hit.value;
    } catch {}
    try { const t = await page.locator(`p:has-text("${label}")`).first().evaluate((el: any) => (el.nextElementSibling as HTMLElement | null)?.textContent || ''); if (t && String(t).trim()) return String(t).trim(); } catch {}
    return '';
  }

  const uofRaw = await getField('Use of Funds');
  const locRaw = await getField('Location');
  const urgRaw = await getField('Urgency');
  const tibRaw = await getField('Time in Business');
  const bankRaw = await getField('Bank Account');
  const revRaw = await getField('Annual Revenue');
  const indRaw = await getField('Industry');

  const lead: FundlyLeadInsert & { filter_success?: string | null; [k: string]: any } = {
    fundly_id: leadId,
    contact_name: nameRaw || 'LOCKED',
    email: emailSanitized || '',
    phone: (isExclusive ? 'LOCKED' : (phoneRaw || 'LOCKED')).trim() || 'LOCKED',
    background_info: backgroundInfo || 'LOCKED',
    email_sent_at: null,
    created_at: new Date().toISOString().replace('Z', '+00:00'),
    can_contact: true,
    use_of_funds: uofRaw || 'LOCKED',
    location: locRaw || 'LOCKED',
    urgency: urgRaw || 'LOCKED',
    time_in_business: tibRaw || 'LOCKED',
    bank_account: bankRaw || 'LOCKED',
    annual_revenue: revRaw || 'LOCKED',
    industry: indRaw || 'LOCKED',
    looking_for_min: 'LOCKED',
    looking_for_max: 'LOCKED'
  };

  // Normalize
  const rev = parseRevenueRange(lead.annual_revenue);
  (lead as any).urgency_code = normalizeUrgency(lead.urgency);
  (lead as any).tib_months = parseTibMonths(lead.time_in_business) ?? -1;
  (lead as any).annual_revenue_min_usd = rev.min ?? -1;
  (lead as any).annual_revenue_max_usd = rev.max ?? -1;
  (lead as any).annual_revenue_usd_approx = rev.approx ?? -1;
  (lead as any).bank_account_bool = normalizeBankAccount(lead.bank_account) ?? false;
  (lead as any).use_of_funds_norm = lead.use_of_funds === 'LOCKED' ? 'locked' : normalizeUseOfFunds(lead.use_of_funds);
  (lead as any).industry_norm = lead.industry === 'LOCKED' ? 'locked' : ((lead.industry || '').trim().toLowerCase() || 'locked');

  // Evaluate for filter_success
  const evalRes = evaluatePrograms(lead as any);
  const qualified = evalRes.programs.filter(p => p.eligible).map(p => p.key);
  function choosePrimary() {
    const text = `${(lead.use_of_funds || '').toLowerCase()} ${(lead.background_info || '').toLowerCase()}`;
    if (qualified.includes('equipment_financing') && /equipment|invoice|quote/.test(text)) return 'equipment_financing';
    const priority = ['working_capital','line_of_credit','business_term_loan','sba_loan','bank_loc','equipment_financing','first_campaign'];
    for (const k of priority) if (qualified.includes(k as any)) return k;
    return qualified[0];
  }
  lead.filter_success = qualified.length ? (choosePrimary() || qualified[0]) : 'FAIL_ALL';

  return { lead, isExclusive } as const;
}

async function main() {
  const BACKFILL_SINCE_ISO = process.env.BACKFILL_SINCE_ISO || '2025-09-16T21:40:37.898Z';
  const BACKFILL_SCROLL_PAGES = Number(process.env.BACKFILL_SCROLL_PAGES || 20);
  const BACKFILL_MAX_TO_ADD = Number(process.env.BACKFILL_MAX_TO_ADD || 300);
  logVar('backfill.params', { BACKFILL_SINCE_ISO, BACKFILL_SCROLL_PAGES, BACKFILL_MAX_TO_ADD });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  let inserted = 0;
  let emailed = 0;
  try {
    const FUNDLY_EMAIL = process.env.FUNDLY_EMAIL || process.env.FUNDLY_USER_EMAIL || '';
    const FUNDLY_PASSWORD = process.env.FUNDLY_PASSWORD || process.env.FUNDLY_USER_PASS || '';
    if (!FUNDLY_EMAIL || !FUNDLY_PASSWORD) throw new Error('Missing FUNDLY creds');

    await page.goto('https://app.getfundly.com/login?redirectTo=/c/business');
    await page.getByRole('textbox', { name: 'Email' }).fill(FUNDLY_EMAIL);
    await page.getByRole('textbox', { name: 'Email' }).press('Enter');
    await page.getByRole('textbox', { name: 'Password' }).fill(FUNDLY_PASSWORD);
    await page.getByRole('button', { name: 'Login' }).click();
    await page.waitForURL(/\/c\/business(\b|\/|\?|$)/, { timeout: 15000 });
    logMsg('Signed in for backfill');

    // Step 1: aggressively add recent timeline leads to pipeline
    let added = 0;
    for (let s = 0; s < BACKFILL_SCROLL_PAGES && added < BACKFILL_MAX_TO_ADD; s++) {
      const addButtons = page.getByRole('button', { name: /Add to My Pipeline/i });
      for (let i = 0; i < 50 && added < BACKFILL_MAX_TO_ADD; i++) {
        const count = await addButtons.count().catch(() => 0);
        if (!count) break;
        await addButtons.first().click({ timeout: 4000 }).catch(() => {});
        added++;
        await page.waitForTimeout(400);
      }
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
      await page.waitForTimeout(600);
    }
    logVar('backfill.addedToPipeline', added);

    // Step 2: go to pipeline and enumerate many IDs
    await page.getByRole('link', { name: 'My Pipeline' }).click();
    await page.waitForTimeout(1500);
    const seen = new Set<string>();
    for (let s = 0; s < 20; s++) {
      const ids = await page.$$eval('div[id]', els => els.map(el => (el as HTMLElement).id).filter(Boolean));
      for (const id of ids) if (/^\d+$/.test(id)) seen.add(id);
      const before = seen.size;
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
      await page.waitForTimeout(700);
      const after = seen.size;
      if (after === before) break; // no new IDs discovered
    }
    const pipelineIds = Array.from(seen);
    logVar('backfill.pipelineIds.count', pipelineIds.length);

    // Step 3: for each ID not yet in DB, extract, insert, maybe email
    for (const leadId of pipelineIds) {
      const exists = await getLeadByFundlyId(leadId).catch(() => null);
      if (exists) continue;
      const { lead, isExclusive } = await extractLeadFromPipeline(page, leadId);
      const saved = await insertLead(lead);
      inserted++;

      // Email decision for backfill: qualify + not exclusive + has email + not already emailed + allowed
      const hasEmail = !!(saved.email && saved.email.includes('@'));
      const evalRes = evaluatePrograms(saved);
      const thresholdOk = evalRes.anyQualified && saved.filter_success && saved.filter_success !== 'FAIL_ALL';
      const already = hasEmail ? await emailAlreadySent(saved.email) : false;
      const allowed = hasEmail ? await canContactByEmail(saved.email) : false;
      const shouldEmail = !isExclusive && thresholdOk && hasEmail && !already && allowed;

      if (shouldEmail) {
        if (DRY_RUN) {
          logMsg('Email suppressed (dry run)', { to: saved.email });
        }
        if (emailSendingEnabled()) {
          const programKey = saved.filter_success && saved.filter_success !== 'FAIL_ALL' ? saved.filter_success : undefined;
          const res = await sendLeadEmail({ to: saved.email!, programKey }).catch(() => null);
          if (res && !(res as any).skipped) {
            await updateEmailSentAt(saved.email!, new Date());
            emailed++;
            logMsg('Email sent (backfill)', { to: saved.email, programKey });
          }
        } else {
          logMsg('Email suppressed (not LaunchAgent context)', { to: saved.email });
        }
      }
    }

    logMsg('Backfill finished', { inserted, emailed });
  } catch (err) {
    logError(err);
    throw err;
  } finally {
    try { await browser.close(); } catch {}
    try { await closePool(); } catch {}
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

