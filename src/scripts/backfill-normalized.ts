#!/usr/bin/env tsx
import 'dotenv/config';
import { query, closePool } from '../database/utils/connection.js';
import { normalizeUrgency, parseTibMonths, parseRevenueRange, normalizeUseOfFunds, normalizeBankAccount } from '../utils/normalize.js';

async function main() {
  const sel = await query('SELECT id, urgency, time_in_business, annual_revenue, bank_account, use_of_funds, industry FROM fundly_leads');
  let updated = 0;
  for (const row of sel.rows) {
    const urgency_code = normalizeUrgency(row.urgency);
    const tib_months = parseTibMonths(row.time_in_business);
    const rev = parseRevenueRange(row.annual_revenue);
    const bank = normalizeBankAccount(row.bank_account);
    const uof = normalizeUseOfFunds(row.use_of_funds);
    const industry_norm = String(row.industry || '').trim().toLowerCase() || null;
    await query(
      `UPDATE fundly_leads
       SET urgency_code = $2,
           tib_months = $3,
           annual_revenue_min_usd = $4,
           annual_revenue_max_usd = $5,
           annual_revenue_usd_approx = $6,
           bank_account_bool = $7,
           use_of_funds_norm = $8,
           industry_norm = $9
       WHERE id = $1`,
      [row.id, urgency_code, tib_months, rev.min, rev.max, rev.approx, bank, uof, industry_norm]
    );
    updated++;
  }
  console.log(`Backfill complete. Updated ${updated} rows.`);
}

try { await main(); } finally { await closePool(); }

