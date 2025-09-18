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
import { FundlyLeadInsert } from '../types/lead.js';
import { passesRequirements, evaluatePrograms } from '../filters/threshold.js';
import { emailSendingEnabled, SCAN_INTERVAL_SECONDS, DRY_RUN } from '../config.js';
import { sendLeadEmail } from '../email/send.js';
import { closePool } from '../database/utils/connection.js';
import { logMsg, logVar, logError } from '../utils/logger.js';
import { withBackoff } from '../utils/backoff';
import { sanitizeEmail } from '../utils/email_utils.js';
import { normalizeUrgency, parseTibMonths, parseRevenueRange, normalizeUseOfFunds, normalizeBankAccount } from '../utils/normalize.js';

function isTodayIso(iso?: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return d.getUTCFullYear() === now.getUTCFullYear() && d.getUTCMonth() === now.getUTCMonth() && d.getUTCDate() === now.getUTCDate();
}

async function runOnce() {
  logMsg('Run started');
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

    // Login (with exponential backoff for transient rate limits/timeouts)
    await withBackoff(async () => {
      await page.goto('https://app.getfundly.com/login?redirectTo=/c/business');
      await page.getByRole('textbox', { name: 'Email' }).fill(FUNDLY_EMAIL);
      await page.getByRole('textbox', { name: 'Email' }).press('Enter');
      await page.getByRole('textbox', { name: 'Password' }).fill(FUNDLY_PASSWORD);
      await page.getByRole('button', { name: 'Login' }).click();
      await page.waitForURL(/\/c\/business(\b|\/|\?|$)/, { timeout: 15000 });
    }, { label: 'login' });
    await page.waitForSelector('text="Realtime Lead Timeline"', { timeout: 10000 }).catch(() => {});
    logMsg('Signed in and on dashboard');

    // Try to add several visible leads to pipeline (scrolling)
    async function addNewLeads(): Promise<number> {
      const addButtons = page.getByRole('button', { name: /Add to My Pipeline/i });
      async function processAllVisible() {
        let clicked = 0;
        for (let attempts = 0; attempts < 50; attempts++) {
          const count = await addButtons.count().catch(() => 0);
          if (!count) break;
          await addButtons.first().click({ timeout: 5000 }).catch(() => {});
          clicked++;
          await page.waitForTimeout(600);
        }
        return clicked;
      }
      let total = 0;
      total += await processAllVisible();
      for (let s = 0; s < 4; s++) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
        await page.waitForTimeout(800);
        total += await processAllVisible();
      }
      return total;
    }
    const addedCount = await withBackoff(() => addNewLeads(), { label: 'addToPipeline', maxRetries: 3 }).catch(() => 0);
    logVar('feed.addedToPipeline', addedCount);

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
    try {
      await page.waitForSelector('p:has-text("Email"), p:has-text("Use of Funds"), h2:has-text("Lead Details")', { timeout: 4000 });
    } catch { await page.waitForTimeout(1200); }

    // Reveal contact if needed (robust set of candidates)
    let revealed = false;
    const revealCandidates = [
      page.getByRole('button', { name: /Reveal/i }),
      page.locator('button:has-text("Reveal Contact")'),
      page.locator('button:has-text("View Contact")'),
      page.locator('button.chakra-button:has-text("Reveal")'),
      page.locator('[data-testid*="reveal"]'),
    ];
    for (const cand of revealCandidates) {
      try {
        if (await cand.count()) {
          const el = cand.first();
          await el.scrollIntoViewIfNeeded().catch(() => {});
          await el.click({ timeout: 2000 }).catch(() => {});
          await page.waitForTimeout(600);
          revealed = true;
          break;
        }
      } catch {}
    }
    logMsg(revealed ? 'Revealed contact info' : 'No Reveal needed');
      // Disabled by request: do not click "Send Code to Lead"
      // try {
      //   const sendCode = page.getByRole('button', { name: /Send Code to Lead/i });
      //   if (await sendCode.count()) {
      //     await sendCode.first().click({ timeout: 3000 });
      //     logMsg('Clicked Send Code to Lead');
      //     await page.waitForTimeout(1200);
      //   }
      // } catch (e) { logError(e, { step: 'send-code' }); }

    const contactTab = page.locator('[role="tabpanel"][aria-labelledby*="tab-0"]');
    let emailRaw = (await contactTab.locator('p:text-is("Email") + p').textContent().catch(() => '')) || '';
    let phoneRaw = (await contactTab.locator('p:text-is("Phone") + p').textContent().catch(() => '')) || '';
    if (!emailRaw) {
      try {
        const handle = await page.locator('p:has-text("Email")').first();
        if (await handle.count()) {
          emailRaw = await handle.evaluate((el: HTMLElement) => (el.nextElementSibling as HTMLElement | null)?.textContent || '');
        }
      } catch {}
    }
    if (!phoneRaw) {
      try {
        const handle = await page.locator('p:has-text("Phone")').first();
        if (await handle.count()) {
          phoneRaw = await handle.evaluate((el: HTMLElement) => (el.nextElementSibling as HTMLElement | null)?.textContent || '');
        }
      } catch {}
    }
    if (!emailRaw) {
      try {
        const href = await page.locator('a[href^="mailto:"]').first().getAttribute('href');
        if (href) emailRaw = href.replace(/^mailto:/i, '').split('?')[0];
      } catch {}
    }
    if (!phoneRaw) {
      try {
        const tel = await page.locator('a[href^="tel:"]').first().getAttribute('href');
        if (tel) phoneRaw = tel.replace(/^tel:/i, '');
      } catch {}
    }
    // Detect exclusivity banner/lock state (email not available yet)
    let isExclusive = false;
    try {
      const banner = await page.locator('h2:has-text("Exclusive with Others")');
      if (await banner.count()) isExclusive = true;
    } catch {}
    if (!isExclusive) {
      try {
        const note = await page.locator('p:has-text("exclusively working with another agent")');
        if (await note.count()) isExclusive = true;
      } catch {}
    }
    if (!isExclusive) {
      try {
        const revealBtn = page.getByRole('button', { name: /Reveal/i });
        if (await revealBtn.count()) isExclusive = await revealBtn.isDisabled().catch(() => false);
      } catch {}
    }
    logVar('contact.exclusive', isExclusive);

    // Extract contact name via multiple strategies
    function cleanName(n: string): string {
      let s = (n || '').replace(/[\n\r]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
      s = s.replace(/\b(am|pm)\b/gi, '').trim();
      s = s.replace(/^(am|pm)\s*/i, '').trim();
      return s;
    }
    let nameRaw = '';
    try { nameRaw = (await page.locator('p:text-is("Name") + p').first().textContent()) || ''; } catch {}
    nameRaw = cleanName(nameRaw);
    if (!nameRaw) {
      try { nameRaw = (await page.locator('p:text-is("Full Name") + p').first().textContent()) || ''; } catch {}
      nameRaw = cleanName(nameRaw);
    }
    if (!nameRaw) {
      // Scan the contact panel for label/value pairs and infer likely name fields
      try {
        const contactPanel = page.locator('[role="tabpanel"][aria-labelledby*="tab-0"]');
        const pairs = await contactPanel.locator('p').evaluateAll((nodes: Element[]) => {
          const out: Array<{ label: string; value: string }> = [];
          for (const el of nodes) {
            const label = (el.textContent || '').trim();
            const next = (el.nextElementSibling as HTMLElement | null)?.textContent || '';
            out.push({ label, value: next.trim() });
          }
          return out;
        }) as Array<{ label: string; value: string }>;
        try { logVar('contact.labels', pairs.map(p => p.label)); } catch {}
        const pick = (rx: RegExp) => pairs.find((p) => rx.test(p.label.toLowerCase()))?.value || '';
        const owner = pick(/^(owner|business owner|primary owner|applicant|contact name)$/i);
        const nameLbl = pick(/^(name|full name|contact name)$/i);
        const first = pick(/^first\s*name$/i);
        const last = pick(/^last\s*name$/i);
        nameRaw = owner || nameLbl || ((first || last) ? `${first} ${last}`.trim() : '');
        if (!nameRaw) {
          // Try to derive from notice like "Gregory is exclusively working with another agent."
        const fullText = pairs.map(p => p.label).join('\n');
        let m = fullText.match(/\b([A-Za-z][A-Za-z'\-]+(?:\s+[A-Za-z][A-Za-z'\-]+){0,2})\s+is\s+exclusively\s+working\s+with\s+another\s+agent\b/i);
        if (!m) {
          try {
            const excl = await page.locator('p:has-text("exclusively working with another agent")').first().textContent();
            if (excl) m = excl.match(/\b([A-Za-z][A-Za-z'\-]+(?:\s+[A-Za-z][A-Za-z'\-]+){0,2})\s+is\s+exclusively/i);
          } catch {}
        }
        if (m) nameRaw = cleanName(m[1]);
      }
      } catch {}
    }
    if (!nameRaw) {
      // Fallback: provided specific CSS path
      const specific = '#root > div > div.css-1v4ow96 > div.css-18088eb > div > div > div > div > div > div.chakra-stack.css-11n7j0t > div > div.chakra-stack.css-1f3yssc > div > div > p.chakra-text.css-21j35u';
      try { nameRaw = cleanName((await page.locator(specific).first().textContent()) || ''); } catch {}
    }

    let emailSanitized = isExclusive ? null : sanitizeEmail(emailRaw);
    logVar('contact.raw', { emailRaw, emailSanitized, phoneRaw });
    try { if (nameRaw) logVar('contact.nameGuess', nameRaw); } catch {}

    // Expand background
    try { await page.getByText('Show more').click({ timeout: 2000 }); } catch {}
    const backgroundInfo = ((await page.locator('p:text-is("Background Info") + p').textContent().catch(() => '')) || '').replace(/Show less$/i, '').trim();
    logVar('background.len', backgroundInfo.length);

    async function getFieldValue(label: string): Promise<string> {
      // 1) exact next-sibling pattern
      try {
        const t = await page.locator(`p:text-is("${label}") + p`).textContent();
        if (t && t.trim()) return t.trim();
      } catch {}
      // 2) within contact tab panel map labels->values
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
      // 3) global fallback
      try {
        const t = await page.locator(`p:has-text("${label}")`).first().evaluate((el: any) => (el.nextElementSibling as HTMLElement | null)?.textContent || '');
        if (t && String(t).trim()) return String(t).trim();
      } catch {}
      return '';
    }

    // Build lead payload
    const uofRaw = await getFieldValue('Use of Funds');
    const locRaw = await getFieldValue('Location');
    const urgRaw = await getFieldValue('Urgency');
    const tibRaw = await getFieldValue('Time in Business');
    const bankRaw = await getFieldValue('Bank Account');
    const revRaw = await getFieldValue('Annual Revenue');
    const indRaw = await getFieldValue('Industry');

    const leadData: FundlyLeadInsert & { filter_success?: string | null } = {
      fundly_id: leadId,
      contact_name: (nameRaw || 'LOCKED').trim() || 'LOCKED',
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
      looking_for_min: '',
      looking_for_max: ''
    };

    // Compute normalization (persisted during insert)
    const revenueNorm = parseRevenueRange(leadData.annual_revenue);
    const urgencyCode = normalizeUrgency(leadData.urgency);
    (leadData as any).urgency_code = urgencyCode === 'unknown' && leadData.urgency === 'LOCKED' ? 'locked' : urgencyCode;
    (leadData as any).tib_months = parseTibMonths(leadData.time_in_business) ?? -1;
    (leadData as any).annual_revenue_min_usd = revenueNorm.min ?? -1;
    (leadData as any).annual_revenue_max_usd = revenueNorm.max ?? -1;
    (leadData as any).annual_revenue_usd_approx = revenueNorm.approx ?? -1;
    const bankBool = normalizeBankAccount(leadData.bank_account);
    (leadData as any).bank_account_bool = (bankBool == null) ? false : bankBool;
    (leadData as any).use_of_funds_norm = leadData.use_of_funds === 'LOCKED' ? 'locked' : normalizeUseOfFunds(leadData.use_of_funds);
    (leadData as any).industry_norm = leadData.industry === 'LOCKED' ? 'locked' : ((leadData.industry || '').trim().toLowerCase() || 'locked');
    try { logVar('normalize.preview', (leadData as any)); } catch {}

    // Parse looking_for range from background text
    if (/How much they are looking for:\s*\$[0-9,]+\s*-\s*\$[0-9,]+/.test(backgroundInfo)) {
      const m = backgroundInfo.match(/How much they are looking for:\s*\$([0-9,]+)\s*-\s*\$([0-9,]+)/);
      if (m) { leadData.looking_for_min = `$${m[1]}`; leadData.looking_for_max = `$${m[2]}`; }
    }
    if (!leadData.looking_for_min) leadData.looking_for_min = 'LOCKED';
    if (!leadData.looking_for_max) leadData.looking_for_max = 'LOCKED';

    {
      // Evaluate before insert to compute filter_success
      const evalResPre = evaluatePrograms(leadData as any);
      const qualifiedPre = evalResPre.programs.filter(p => p.eligible).map(p => p.key);
      function choosePrimaryProgram(): string | undefined {
        const text = `${(leadData.use_of_funds || '').toLowerCase()} ${(leadData.background_info || '').toLowerCase()}`;
        if (qualifiedPre.includes('equipment_financing') && /equipment|invoice|quote/.test(text)) return 'equipment_financing';
        const priority: string[] = ['working_capital','line_of_credit','business_term_loan','sba_loan','bank_loc','equipment_financing','first_campaign'];
        for (const k of priority) if (qualifiedPre.includes(k as any)) return k;
        return qualifiedPre[0];
      }
      leadData.filter_success = qualifiedPre.length ? (choosePrimaryProgram() || qualifiedPre[0]) : 'FAIL_ALL';

      // Insert even if email is missing; use fundly_id for upsert in that case
      const savedLead = await insertLead(leadData);
      saved = 1;
      logVar('db.savedLead', { id: savedLead.id, email: savedLead.email, fundly_id: (savedLead as any).fundly_id });

      // Decision: new today + qualifies for any program + not emailed yet + allowed to contact
      const newToday = isTodayIso(savedLead.created_at);
      const evalRes = evaluatePrograms(savedLead);
      const qualified = evalRes.programs.filter(p => p.eligible).map(p => p.key);
      logVar('filters.programs', { anyQualified: evalRes.anyQualified, qualified });
      const thresholdOk = evalRes.anyQualified;
      const hasEmail = !!(savedLead.email && savedLead.email.includes('@'));
      const already = hasEmail ? await emailAlreadySent(savedLead.email!) : false;
      const allowed = hasEmail ? await canContactByEmail(savedLead.email!) : false;
      const shouldEmail = newToday && thresholdOk && !already && allowed;

      if (shouldEmail) {
        if (DRY_RUN) {
          logMsg('Email suppressed (dry run)', { to: savedLead.email });
        }
        if (emailSendingEnabled()) {
          const programKey = leadData.filter_success && leadData.filter_success !== 'FAIL_ALL' ? leadData.filter_success : undefined;
          const res = await withBackoff(() => sendLeadEmail({ to: savedLead.email!, programKey }), { label: 'sendEmail', maxRetries: 4 }).catch(() => null);
          if (res && !(res as any).skipped) {
            await updateEmailSentAt(savedLead.email!, new Date());
            emailed = 1;
            logMsg('Email sent', { to: savedLead.email, programKey });
          }
        } else {
          logMsg('Email suppressed (not LaunchAgent context)', { to: savedLead.email });
        }
      }
    }

    logMsg('Run finished', { discovered, saved, emailed });
  } catch (error) {
    const msg = (error as Error)?.message || String(error);
    logError(error);
    throw error;
  } finally {
    try { await browser.close(); } catch {}
    try { await closePool(); } catch {}
  }
}

try {
  const { pathToFileURL } = await import('url');
  const invoked = pathToFileURL(process.argv[1]).href;
  if (import.meta.url === invoked) {
    runOnce().catch((e) => { console.error(e); process.exit(1); });
    // Log scan interval for observability
    try { logVar('config.scanIntervalSeconds', SCAN_INTERVAL_SECONDS); } catch {}
  }
} catch {
  // Older Node or unusual env; just run
  runOnce().catch((e) => { console.error(e); process.exit(1); });
}

// Crash logging still goes to file logs via logger
process.on('uncaughtException', (e) => { try { logError(e); } catch {} });
process.on('unhandledRejection', (e) => { try { logError(e); } catch {} });
