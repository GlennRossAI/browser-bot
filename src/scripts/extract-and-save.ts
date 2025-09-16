#!/usr/bin/env tsx

/**
 * Complete script to extract Fundly lead data and save to database
 * Usage: tsx src/scripts/extract-and-save.ts
 */

import { chromium } from 'playwright';
import { insertLead } from '../database/queries/leads.js';
import { closePool } from '../database/utils/connection.js';
import { FundlyLeadInsert } from '../types/lead.js';
import { normalizeUrgency, parseTibMonths, parseRevenueRange, normalizeUseOfFunds, normalizeBankAccount } from '../utils/normalize.js';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  try {
    const FUNDLY_EMAIL = process.env.FUNDLY_EMAIL || process.env.FUNDLY_USER_EMAIL || '';
    const FUNDLY_PASSWORD = process.env.FUNDLY_PASSWORD || process.env.FUNDLY_USER_PASS || '';
    if (!FUNDLY_EMAIL || !FUNDLY_PASSWORD) {
      throw new Error('Missing FUNDLY_EMAIL/FUNDLY_PASSWORD in environment');
    }

    console.log("🔄 Logging into Fundly...");

    // Navigate to login
    await page.goto("https://app.getfundly.com/login?redirectTo=/c/business");

    // Login
    await page.getByRole("textbox", { name: "Email" }).fill(FUNDLY_EMAIL);
    await page.getByRole("textbox", { name: "Email" }).press("Enter");
    await page.getByRole("textbox", { name: "Password" }).fill(FUNDLY_PASSWORD);
    await page.getByRole("button", { name: "Login" }).click();

    // Wait for login
    await page.waitForURL(/\/c\/business(\b|\/|\?|$)/, { timeout: 15000 });

    // Wait for dashboard
    await page.waitForSelector('text="Realtime Lead Timeline"', { timeout: 10000 });

    // Try to add latest lead
    const addButtons = await page.$$('button[label="Add to My Pipeline"]');
    let leadId: string | null = null;

    if (addButtons.length > 0) {
      const addBtn = addButtons[0];
      const containerHandle = await addBtn.evaluateHandle((btn) =>
        (btn as HTMLElement).closest('div[id]') as HTMLElement | null
      );
      leadId = await containerHandle.evaluate((el: HTMLElement | null) => el?.id || null);
      console.log("🎯 Found lead to add:", leadId);

      try {
        await addBtn.click();
        await page.waitForTimeout(2000);
      } catch (e) {
        console.warn("⚠️ Could not add lead, proceeding...");
      }
    }

    // Navigate to pipeline
    await page.getByRole("link", { name: "My Pipeline" }).click();
    await page.waitForTimeout(3000);

    // Get available leads
    const pipelineLeads = await page.$$eval(
      "div[id]",
      (els) => els.map((el) => (el as HTMLElement).id).filter(Boolean)
    );

    if (!leadId && pipelineLeads.length > 0) {
      leadId = pipelineLeads[0];
    }

    if (!leadId) {
      throw new Error("No leads available to extract");
    }

    console.log("📋 Extracting data from lead:", leadId);

    // Click on lead
    await page.locator(`div[id="${leadId}"]`).first().click();

    // Try to reveal if needed
    try {
      await page.getByRole("button", { name: "Reveal" }).click({ timeout: 5000 });
      console.log("✅ Contact info revealed");
    } catch {
      console.log("ℹ️ Contact info already visible");
    }

    // Extract email, phone, and name
    function cleanName(n: string): string {
      let s = (n || '').replace(/[\n\r]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
      s = s.replace(/\b(am|pm)\b/gi, '').trim();
      s = s.replace(/^(am|pm)\s*/i, '').trim();
      return s;
    }
    const contactSection = page.locator('[role="tabpanel"][aria-labelledby*="tab-0"]');
    // Try stable label-next-sibling pattern
    const nameFromLabel = await contactSection.locator('p:text-is("Name") + p').textContent().then(v => (v || '').trim()).catch(() => '');
    // Fallbacks for different UI variants
    let nameAlt = nameFromLabel || await contactSection.locator('p:text-is("Full Name") + p').textContent().then(v => cleanName(v || '')).catch(() => '') || '';
    if (!(nameAlt || '').trim()) {
      // Generalized label scan
      try {
        const pairs = await contactSection.locator('p').evaluateAll((nodes: Element[]) => {
          const out: Array<{ label: string; value: string }> = [];
          for (const el of nodes) {
            const label = (el.textContent || '').trim();
            const next = (el.nextElementSibling as HTMLElement | null)?.textContent || '';
            out.push({ label, value: next.trim() });
          }
          return out;
        }) as Array<{ label: string; value: string }>;
        const pick = (rx: RegExp) => pairs.find((p) => rx.test(p.label.toLowerCase()))?.value || '';
        const owner = pick(/^(owner|business owner|primary owner|applicant|contact name)$/i);
        const nameLbl = pick(/^(name|full name|contact name)$/i);
        const first = pick(/^first\s*name$/i);
        const last = pick(/^last\s*name$/i);
        nameAlt = cleanName(owner || nameLbl || ((first || last) ? `${first} ${last}`.trim() : ''));
        if (!nameAlt) {
          const fullText = pairs.map(p => p.label).join('\n');
          const m = fullText.match(/\b([A-Za-z][A-Za-z'\-]+(?:\s+[A-Za-z][A-Za-z'\-]+){0,2})\s+is\s+exclusively\s+working\s+with\s+another\s+agent\b/i);
          if (m) nameAlt = m[1].trim();
        }
      } catch {}
    }

    if (!(nameAlt || '').trim()) {
      // Fallback: provided specific CSS path
      const specific = '#root > div > div.css-1v4ow96 > div.css-18088eb > div > div > div > div > div > div.chakra-stack.css-11n7j0t > div > div.chakra-stack.css-1f3yssc > div > div > p.chakra-text.css-21j35u';
      try {
        nameAlt = cleanName((await page.locator(specific).first().textContent()) || '');
      } catch {}
    }
    const email = await contactSection.locator('p:text-is("Email") + p').textContent() || "Unknown Email";
    const phone = await contactSection.locator('p:text-is("Phone") + p').textContent() || "Unknown Phone";

    // Expand background info
    try {
      await page.getByText("Show more").click({ timeout: 3000 });
      console.log("📄 Background info expanded");
    } catch {
      console.log("ℹ️ Background info already expanded");
    }

    // Detect exclusivity
    let isExclusive = false;
    try { if (await page.locator('h2:has-text("Exclusive with Others")').count()) isExclusive = true; } catch {}
    if (!isExclusive) { try { const btn = page.getByRole('button', { name: /Reveal/i }); if (await btn.count()) isExclusive = await btn.isDisabled().catch(() => false); } catch {} }
    if (!isExclusive) { try { if (await page.locator('p:has-text("exclusively working with another agent")').count()) isExclusive = true; } catch {} }

    // Extract all field data
    const backgroundInfoRaw = await page.locator('p:text-is("Background Info") + p').textContent() || "";
    const backgroundInfo = backgroundInfoRaw.replace(/Show less$/i, "").trim();

    const getFieldValue = async (fieldName: string) => {
      try {
        return await page.locator(`p:text-is("${fieldName}") + p`).textContent() || "";
      } catch {
        return "";
      }
    };

    const uofRaw = await getFieldValue("Use of Funds");
    const locRaw = await getFieldValue("Location");
    const urgRaw = await getFieldValue("Urgency");
    const tibRaw = await getFieldValue("Time in Business");
    const bankRaw = await getFieldValue("Bank Account");
    const revRaw = await getFieldValue("Annual Revenue");
    const indRaw = await getFieldValue("Industry");

    const leadData: FundlyLeadInsert = {
      fundly_id: leadId,
      contact_name: (nameAlt || '').trim(),
      email: (email.trim() || (isExclusive ? 'LOCKED' : '')),
      phone: phone.trim(),
      background_info: backgroundInfo,
      email_sent_at: null,
      created_at: new Date().toISOString().replace("Z", "+00:00"),
      can_contact: true,
      use_of_funds: (isExclusive && !uofRaw) ? 'LOCKED' : uofRaw,
      location: (isExclusive && !locRaw) ? 'LOCKED' : locRaw,
      urgency: (isExclusive && !urgRaw) ? 'LOCKED' : urgRaw,
      time_in_business: (isExclusive && !tibRaw) ? 'LOCKED' : tibRaw,
      bank_account: (isExclusive && !bankRaw) ? 'LOCKED' : bankRaw,
      annual_revenue: (isExclusive && !revRaw) ? 'LOCKED' : revRaw,
      industry: (isExclusive && !indRaw) ? 'LOCKED' : indRaw,
      looking_for_min: "",
      looking_for_max: ""
    };

    // Phase 1: log normalization (no DB writes yet)
    try {
      const norm = {
        urgency_code: normalizeUrgency(leadData.urgency),
        tib_months: parseTibMonths(leadData.time_in_business),
        revenue: parseRevenueRange(leadData.annual_revenue),
        bank_account_bool: normalizeBankAccount(leadData.bank_account),
        use_of_funds_norm: normalizeUseOfFunds(leadData.use_of_funds),
      };
      console.log('normalize.preview', norm);
    } catch {}

    // Parse funding range from background info
    if (backgroundInfo.includes("How much they are looking for:")) {
      const rangeMatch = backgroundInfo.match(
        /How much they are looking for:\s*\$([0-9,]+)\s*-\s*\$([0-9,]+)/
      );
      if (rangeMatch) {
        leadData.looking_for_min = `$${rangeMatch[1]}`;
        leadData.looking_for_max = `$${rangeMatch[2]}`;
      }
    }

    console.log("💾 Saving lead to database...");
    const savedLead = await insertLead(leadData);

    console.log("✅ Lead extracted and saved successfully!");
    console.log(`📧 Email: ${savedLead.email}`);
    console.log(`📞 Phone: ${savedLead.phone}`);
    console.log(`🏢 Industry: ${savedLead.industry}`);
    console.log(`💰 Looking for: ${savedLead.looking_for_min} - ${savedLead.looking_for_max}`);
    console.log(`🗃️ Database ID: ${savedLead.id}`);

  } catch (error) {
    console.error("❌ Error during extraction:", error);
    throw error;
  } finally {
    await browser.close();
    await closePool();
  }
}

if (require.main === module) {
  main().catch(console.error);
}
