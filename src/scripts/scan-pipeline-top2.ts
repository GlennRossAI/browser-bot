#!/usr/bin/env tsx
import 'dotenv/config';
import { chromium, Page } from 'playwright';
import { insertLead } from '../database/queries/leads.js';
import { closePool } from '../database/utils/connection.js';
import { FundlyLeadInsert } from '../types/lead.js';
import { evaluatePrograms } from '../filters/threshold.js';
import { sanitizeEmail } from '../utils/email_utils.js';
import { logMsg, logVar } from '../utils/logger.js';

async function extractOne(page: Page, leadId: string) {
  await page.locator(`div[id="${leadId}"]`).first().click();
  await page.waitForTimeout(600);

  // Exclusivity
  let isExclusive = false;
  try { if (await page.locator('h2:has-text("Exclusive with Others")').count()) isExclusive = true; } catch {}
  if (!isExclusive) { try { const btn = page.getByRole('button', { name: /Reveal/i }); if (await btn.count()) isExclusive = await btn.isDisabled().catch(() => false); } catch {} }
  if (!isExclusive) { try { if (await page.locator('p:has-text("exclusively working with another agent")').count()) isExclusive = true; } catch {} }
  logVar('contact.exclusive', isExclusive);

  // Contact panel
  let emailRaw = '';
  let phoneRaw = '';
  try { emailRaw = await page.locator('p:text-is("Email") + p').first().textContent() || ''; } catch {}
  try { phoneRaw = await page.locator('p:text-is("Phone") + p').first().textContent() || ''; } catch {}
  if (!emailRaw) {
    try { const href = await page.locator('a[href^="mailto:"]').first().getAttribute('href'); if (href) emailRaw = href.replace(/^mailto:/i, '').split('?')[0]; } catch {}
  }
  const emailSanitized = sanitizeEmail(emailRaw) || (isExclusive ? 'LOCKED' : '');

  // Name
  let nameRaw = '';
  try { nameRaw = (await page.locator('p:text-is("Name") + p').first().textContent()) || ''; } catch {}
  if (!nameRaw) { try { nameRaw = (await page.locator('p:text-is("Full Name") + p').first().textContent()) || ''; } catch {} }
  nameRaw = (nameRaw || '').trim();

  // Background
  try { await page.getByText('Show more').click({ timeout: 1500 }); } catch {}
  const backgroundInfo = ((await page.locator('p:text-is("Background Info") + p').textContent().catch(() => '')) || '').replace(/Show less$/i, '').trim();

  const getField = async (label: string) => {
    try { return (await page.locator(`p:text-is("${label}") + p`).textContent())?.trim() || ''; } catch { return ''; }
  };

  const uofRaw = await getField('Use of Funds');
  const locRaw = await getField('Location');
  const urgRaw = await getField('Urgency');
  const tibRaw = await getField('Time in Business');
  const bankRaw = await getField('Bank Account');
  const revRaw = await getField('Annual Revenue');
  const indRaw = await getField('Industry');

  const lead: FundlyLeadInsert & { filter_success?: string | null } = {
    fundly_id: leadId,
    contact_name: nameRaw,
    email: emailSanitized || '',
    phone: (phoneRaw || '').trim(),
    background_info: backgroundInfo,
    email_sent_at: null,
    created_at: new Date().toISOString().replace('Z', '+00:00'),
    can_contact: true,
    use_of_funds: (isExclusive && !uofRaw) ? 'LOCKED' : uofRaw,
    location: (isExclusive && !locRaw) ? 'LOCKED' : locRaw,
    urgency: (isExclusive && !urgRaw) ? 'LOCKED' : urgRaw,
    time_in_business: (isExclusive && !tibRaw) ? 'LOCKED' : tibRaw,
    bank_account: (isExclusive && !bankRaw) ? 'LOCKED' : bankRaw,
    annual_revenue: (isExclusive && !revRaw) ? 'LOCKED' : revRaw,
    industry: (isExclusive && !indRaw) ? 'LOCKED' : indRaw,
    looking_for_min: '',
    looking_for_max: ''
  };

  const evalRes = evaluatePrograms(lead as any);
  const qualified = evalRes.programs.filter(p => p.eligible).map(p => p.key);
  const text = `${(lead.use_of_funds || '').toLowerCase()} ${(lead.background_info || '').toLowerCase()}`;
  function choosePrimary() {
    if (qualified.includes('equipment_financing') && /equipment|invoice|quote/.test(text)) return 'equipment_financing';
    const priority = ['working_capital','line_of_credit','business_term_loan','sba_loan','bank_loc','equipment_financing','first_campaign'];
    for (const k of priority) if (qualified.includes(k as any)) return k;
    return qualified[0];
  }
  lead.filter_success = qualified.length ? (choosePrimary() || qualified[0]) : 'FAIL_ALL';
  logVar('filters.programs', { anyQualified: evalRes.anyQualified, qualified, filter_success: lead.filter_success });

  const saved = await insertLead(lead);
  logVar('db.savedLead', { id: saved.id, fundly_id: (saved as any).fundly_id, email: saved.email, filter_success: (saved as any).filter_success });
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    const FUNDLY_EMAIL = process.env.FUNDLY_EMAIL || '';
    const FUNDLY_PASSWORD = process.env.FUNDLY_PASSWORD || '';
    if (!FUNDLY_EMAIL || !FUNDLY_PASSWORD) throw new Error('Missing FUNDLY creds');

    await page.goto('https://app.getfundly.com/login?redirectTo=/c/business');
    await page.getByRole('textbox', { name: 'Email' }).fill(FUNDLY_EMAIL);
    await page.getByRole('textbox', { name: 'Email' }).press('Enter');
    await page.getByRole('textbox', { name: 'Password' }).fill(FUNDLY_PASSWORD);
    await page.getByRole('button', { name: 'Login' }).click();
    await page.waitForURL(/\/c\/business(\b|\/|\?|$)/, { timeout: 15000 });

    await page.getByRole('link', { name: 'My Pipeline' }).click();
    await page.waitForTimeout(2500);
    // Try to collect container IDs that look like lead cards
    let ids = await page.$$eval('div[id]', els => els.map(el => (el as HTMLElement).id).filter(Boolean));
    let filtered = ids.filter(id => /^\d+$/.test(id));
    if (filtered.length < 2) {
      // Fallback: find numeric id containers that contain an Email field nearby
      filtered = await page.$$eval('div[id]', (nodes) => {
        const out: string[] = [];
        for (const el of nodes as any as HTMLElement[]) {
          const id = el.id || '';
          if (!/^\d+$/.test(id)) continue;
          const hasEmailLabel = !!el.querySelector('p') && Array.from(el.querySelectorAll('p')).some(p => /\bEmail\b/i.test(p.textContent || ''));
          if (hasEmailLabel) out.push(id);
        }
        return out;
      });
    }
    if (filtered.length < 2) {
      // Last resort: scroll and try again
      for (let i = 0; i < 4 && filtered.length < 2; i++) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(800);
        ids = await page.$$eval('div[id]', els => els.map(el => (el as HTMLElement).id).filter(Boolean));
        const more = ids.filter(id => /^\d+$/.test(id));
        filtered = Array.from(new Set([...filtered, ...more]));
      }
    }
    const top2 = filtered.slice(0, 2);
    logVar('pipeline.top2', top2);
    for (const id of top2) {
      await extractOne(page, id);
    }
    logMsg('Done pipeline top2');
  } finally {
    try { await browser.close(); } catch {}
    try { await closePool(); } catch {}
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
