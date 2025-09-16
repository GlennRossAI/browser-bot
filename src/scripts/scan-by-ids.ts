#!/usr/bin/env tsx
import 'dotenv/config';
import { chromium, Page } from 'playwright';
import { insertLead } from '../database/queries/leads.js';
import { closePool } from '../database/utils/connection.js';
import { FundlyLeadInsert } from '../types/lead.js';
import { evaluatePrograms } from '../filters/threshold.js';
import { sanitizeEmail } from '../utils/email_utils.js';
import { normalizeUrgency, parseTibMonths, parseRevenueRange, normalizeUseOfFunds, normalizeBankAccount } from '../utils/normalize.js';

async function extractFromPipeline(page: Page, pipelineId: string) {
  await page.goto(`https://app.getfundly.com/pipeline/business/${pipelineId}`);
  try {
    await page.waitForSelector('h2:has-text("Lead Details"), p:has-text("Use of Funds"), p:has-text("Email")', { timeout: 40000 });
  } catch {
    await page.waitForTimeout(3000);
  }
  // Try to reveal contact if available
  try {
    const reveal = page.getByRole('button', { name: /Reveal/i });
    if (await reveal.count()) {
      const disabled = await reveal.isDisabled().catch(() => false);
      if (!disabled) await reveal.click({ timeout: 3000 }).catch(() => {});
    }
  } catch {}
  try { await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); } catch {}

  // Exclusivity banner
  let isExclusive = false;
  try { if (await page.locator('h2:has-text("Exclusive with Others")').count()) isExclusive = true; } catch {}
  try { const btn = page.getByRole('button', { name: /Reveal/i }); if (await btn.count()) isExclusive = isExclusive || await btn.isDisabled().catch(() => false); } catch {}
  try { if (await page.locator('p:has-text("exclusively working with another agent")').count()) isExclusive = true; } catch {}

  function cleanName(n?: string | null) {
    let s = String(n || '').replace(/[\n\r]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
    s = s.replace(/\b(am|pm)\b/gi, '').trim();
    s = s.replace(/^(am|pm)\s*/i, '').trim();
    return s || 'LOCKED';
  }

  async function field(label: string): Promise<string> {
    try { const t = await page.locator(`p:text-is("${label}") + p`).textContent(); if (t && t.trim()) return t.trim(); } catch {}
    try {
      const t = await page.locator(`p:has-text("${label}")`).first().evaluate((el: any) => (el.nextElementSibling as HTMLElement | null)?.textContent || '');
      if (t && String(t).trim()) return String(t).trim();
    } catch {}
    return 'LOCKED';
  }

  // Contact info
  let emailRaw = '';
  try { emailRaw = await page.locator('p:text-is("Email") + p').first().textContent() || ''; } catch {}
  if (!emailRaw) { try { const href = await page.locator('a[href^="mailto:"]').first().getAttribute('href'); if (href) emailRaw = href.replace(/^mailto:/i, '').split('?')[0]; } catch {} }
  const email = sanitizeEmail(emailRaw) || 'LOCKED';
  let name = '';
  try { name = await page.locator('p:text-is("Name") + p').first().textContent() || ''; } catch {}
  if (!name) { try { name = await page.locator('p:text-is("Full Name") + p').first().textContent() || ''; } catch {} }
  name = cleanName(name);
  let phone = '';
  try { phone = await page.locator('p:text-is("Phone") + p').first().textContent() || ''; } catch {}
  if (!phone) { try { const tel = await page.locator('a[href^="tel:"]').first().getAttribute('href'); if (tel) phone = tel.replace(/^tel:/i, ''); } catch {} }
  phone = isExclusive ? 'LOCKED' : (phone || 'LOCKED');

  // Details
  const use_of_funds = await field('Use of Funds');
  const location = await field('Location');
  const urgency = await field('Urgency');
  const time_in_business = await field('Time in Business');
  const bank_account = await field('Bank Account');
  const annual_revenue = await field('Annual Revenue');
  const industry = await field('Industry');

  // Background
  try { await page.getByText('Show more').click({ timeout: 1500 }); } catch {}
  const background_info = ((await page.locator('p:text-is("Background Info") + p').textContent().catch(() => '')) || '').replace(/Show less$/i, '').trim() || 'LOCKED';

  // looking_for
  let looking_for_min = 'LOCKED';
  let looking_for_max = 'LOCKED';
  if (/How much they are looking for:\s*\$[0-9,]+\s*-\s*\$[0-9,]+/i.test(background_info)) {
    const m = background_info.match(/How much they are looking for:\s*\$([0-9,]+)\s*-\s*\$([0-9,]+)/i);
    if (m) { looking_for_min = `$${m[1]}`; looking_for_max = `$${m[2]}`; }
  }

  const lead: FundlyLeadInsert & { filter_success?: string | null; [k: string]: any } = {
    fundly_id: pipelineId,
    contact_name: name,
    email,
    phone,
    background_info,
    email_sent_at: null,
    created_at: new Date().toISOString().replace('Z', '+00:00'),
    can_contact: true,
    use_of_funds,
    location,
    urgency,
    time_in_business,
    bank_account,
    annual_revenue,
    industry,
    looking_for_min,
    looking_for_max
  };

  // Normalization
  const rev = parseRevenueRange(annual_revenue);
  lead.urgency_code = normalizeUrgency(urgency);
  lead.tib_months = parseTibMonths(time_in_business) ?? -1;
  lead.annual_revenue_min_usd = rev.min ?? -1;
  lead.annual_revenue_max_usd = rev.max ?? -1;
  lead.annual_revenue_usd_approx = rev.approx ?? -1;
  lead.bank_account_bool = normalizeBankAccount(bank_account) ?? false;
  lead.use_of_funds_norm = use_of_funds === 'LOCKED' ? 'locked' : normalizeUseOfFunds(use_of_funds);
  lead.industry_norm = industry === 'LOCKED' ? 'locked' : (industry.toLowerCase() || 'locked');

  const evalRes = evaluatePrograms(lead as any);
  const qualified = evalRes.programs.filter(p => p.eligible).map(p => p.key);
  lead.filter_success = qualified.length ? qualified[0] : 'FAIL_ALL';

  await insertLead(lead);
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

    const args = process.argv.slice(2);
    const ids = args.length ? args : ['573311', '574106'];
    for (const id of ids) {
      await extractFromPipeline(page, id);
    }
    console.log('Inserted', ids.length, 'leads.');
  } finally {
    try { await browser.close(); } catch {}
    try { await closePool(); } catch {}
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
