#!/usr/bin/env tsx
import 'dotenv/config';
import { chromium, Page } from 'playwright';
import { insertLead } from '../database/queries/leads.js';
import { closePool } from '../database/utils/connection.js';
import { FundlyLeadInsert } from '../types/lead.js';
import { evaluatePrograms } from '../filters/threshold.js';
import { normalizeUrgency, parseTibMonths, parseRevenueRange, normalizeUseOfFunds, normalizeBankAccount } from '../utils/normalize.js';
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
  const emailSanitized = isExclusive ? null : (sanitizeEmail(emailRaw));

  // Name
  let nameRaw = '';
  try { nameRaw = (await page.locator('p:text-is("Name") + p').first().textContent()) || ''; } catch {}
  if (!nameRaw) { try { nameRaw = (await page.locator('p:text-is("Full Name") + p').first().textContent()) || ''; } catch {} }
  function cleanName(n: string): string {
    let s = (n || '').replace(/[\n\r]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
    s = s.replace(/\b(am|pm)\b/gi, '').trim();
    s = s.replace(/^(am|pm)\s*/i, '').trim();
    return s || 'LOCKED';
  }
  nameRaw = cleanName(nameRaw);

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
    email: emailSanitized || null,
    phone: (isExclusive ? null : ((phoneRaw || '').trim() || null)),
    background_info: backgroundInfo || 'LOCKED',
    email_sent_at: null,
    created_at: new Date().toISOString().replace('Z', '+00:00'),
    can_contact: true,
    locked: isExclusive,
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

  // Normalize and attach
  const rev = parseRevenueRange(lead.annual_revenue);
  (lead as any).urgency_code = normalizeUrgency(lead.urgency);
  (lead as any).tib_months = parseTibMonths(lead.time_in_business) ?? -1;
  (lead as any).annual_revenue_min_usd = rev.min ?? -1;
  (lead as any).annual_revenue_max_usd = rev.max ?? -1;
  (lead as any).annual_revenue_usd_approx = rev.approx ?? -1;
  (lead as any).bank_account_bool = normalizeBankAccount(lead.bank_account) ?? false;
  (lead as any).use_of_funds_norm = lead.use_of_funds === 'LOCKED' ? 'locked' : normalizeUseOfFunds(lead.use_of_funds);
  (lead as any).industry_norm = lead.industry === 'LOCKED' ? 'locked' : ((lead.industry || '').trim().toLowerCase() || 'locked');

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
