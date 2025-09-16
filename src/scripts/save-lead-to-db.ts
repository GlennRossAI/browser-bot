#!/usr/bin/env tsx

/**
 * Script to save extracted lead data to the database
 * Usage: tsx src/scripts/save-lead-to-db.ts [path-to-json-file]
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { insertLead } from '../database/queries/leads.js';
import { closePool } from '../database/utils/connection.js';
import { FundlyLeadInsert } from '../types/lead.js';

async function main() {
  const jsonPath = process.argv[2] || 'data/extracted-lead-data.json';
  const fullPath = resolve(process.cwd(), jsonPath);

  try {
    console.log(`Reading lead data from: ${fullPath}`);
    const jsonData = JSON.parse(readFileSync(fullPath, 'utf8'));

    // Convert the JSON data to match our database structure
    const leadData: FundlyLeadInsert = {
      fundly_id: jsonData.id || jsonData.fundly_id,
      contact_name: jsonData.contact_name || jsonData.name || '',
      email: jsonData.email,
      phone: jsonData.phone,
      background_info: jsonData.background_info,
      email_sent_at: jsonData.email_sent_at ? new Date(jsonData.email_sent_at) : null,
      created_at: jsonData.created_at,
      can_contact: jsonData.can_contact ?? true,
      use_of_funds: jsonData.use_of_funds || '',
      location: jsonData.location || '',
      urgency: jsonData.urgency || '',
      time_in_business: jsonData.time_in_business || '',
      bank_account: jsonData.bank_account || '',
      annual_revenue: jsonData.annual_revenue || '',
      industry: jsonData.industry || '',
      looking_for_min: jsonData.looking_for_min || '',
      looking_for_max: jsonData.looking_for_max || ''
    };

    console.log('Saving lead to database...');
    const result = await insertLead(leadData);

    console.log('✅ Lead saved successfully!');
    console.log(`Database ID: ${result.id}`);
    console.log(`Email: ${result.email}`);
    console.log(`Fundly ID: ${result.fundly_id}`);

  } catch (error) {
    console.error('❌ Error saving lead:', error);
    process.exit(1);
  } finally {
    await closePool();
  }
}

if (require.main === module) {
  main();
}
