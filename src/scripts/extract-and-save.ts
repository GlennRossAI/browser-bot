#!/usr/bin/env tsx

/**
 * Complete script to extract Fundly lead data and save to database
 * Usage: tsx src/scripts/extract-and-save.ts
 */

import { chromium } from 'playwright';
import { insertLead } from '../database/queries/leads.js';
import { closePool } from '../database/utils/connection.js';
import { FundlyLeadInsert } from '../types/lead.js';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  try {
    const FUNDLY_EMAIL = process.env.FUNDLY_EMAIL || "jeff@glenross.ai";
    const FUNDLY_PASSWORD = process.env.FUNDLY_PASSWORD || "jotcyv-ryzvy8-Quzjih";

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
    const contactSection = page.locator('[role="tabpanel"][aria-labelledby*="tab-0"]');
    // Try stable label-next-sibling pattern
    const nameFromLabel = await contactSection.locator('p:text-is("Name") + p').textContent().catch(() => '');
    // Fallbacks for different UI variants
    const nameAlt = nameFromLabel || await contactSection.locator('p:text-is("Full Name") + p').textContent().catch(() => '') || '';
    const email = await contactSection.locator('p:text-is("Email") + p').textContent() || "Unknown Email";
    const phone = await contactSection.locator('p:text-is("Phone") + p').textContent() || "Unknown Phone";

    // Expand background info
    try {
      await page.getByText("Show more").click({ timeout: 3000 });
      console.log("📄 Background info expanded");
    } catch {
      console.log("ℹ️ Background info already expanded");
    }

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

    const leadData: FundlyLeadInsert = {
      fundly_id: leadId,
      contact_name: (nameAlt || '').trim(),
      email: email.trim(),
      phone: phone.trim(),
      background_info: backgroundInfo,
      email_sent_at: null,
      created_at: new Date().toISOString().replace("Z", "+00:00"),
      can_contact: true,
      use_of_funds: await getFieldValue("Use of Funds"),
      location: await getFieldValue("Location"),
      urgency: await getFieldValue("Urgency"),
      time_in_business: await getFieldValue("Time in Business"),
      bank_account: await getFieldValue("Bank Account"),
      annual_revenue: await getFieldValue("Annual Revenue"),
      industry: await getFieldValue("Industry"),
      looking_for_min: "",
      looking_for_max: ""
    };

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
