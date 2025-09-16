import { query } from '../utils/connection.js';
import { FundlyLead, FundlyLeadInsert } from '../../types/lead.js';

export async function insertLead(lead: FundlyLeadInsert): Promise<FundlyLead> {
  const lookingCombined = (lead.looking_for_min || lead.looking_for_max)
    ? [lead.looking_for_min, lead.looking_for_max].filter(Boolean).join(' - ')
    : '';
  const commonValues = [
    lead.fundly_id,
    lead.contact_name,
    lead.email,
    lead.phone,
    lead.background_info,
    lead.email_sent_at,
    lead.created_at || new Date().toISOString(),
    lead.can_contact,
    lead.use_of_funds,
    lead.location,
    lead.urgency,
    lead.time_in_business,
    lead.bank_account,
    lead.annual_revenue,
    lead.industry,
    lookingCombined || null,
    lead.looking_for_min,
    lead.looking_for_max,
    // normalized columns
    (lead as any).urgency_code ?? null,
    (lead as any).tib_months ?? null,
    (lead as any).annual_revenue_min_usd ?? null,
    (lead as any).annual_revenue_max_usd ?? null,
    (lead as any).annual_revenue_usd_approx ?? null,
    (lead as any).bank_account_bool ?? null,
    (lead as any).use_of_funds_norm ?? null,
    (lead as any).industry_norm ?? null
  ];

  // Consider email only if it looks like an email address
  const upsertOnEmail = !!(lead.email && /@/.test(String(lead.email)));
  const sql = upsertOnEmail ? `
    INSERT INTO fundly_leads (
      fundly_id, contact_name, email, phone, background_info, email_sent_at, created_at,
      can_contact, use_of_funds, location, urgency, time_in_business,
      bank_account, annual_revenue, industry, looking_for, looking_for_min, looking_for_max,
      urgency_code, tib_months, annual_revenue_min_usd, annual_revenue_max_usd, annual_revenue_usd_approx,
      bank_account_bool, use_of_funds_norm, industry_norm,
      filter_success
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
      $19, $20, $21, $22, $23, $24, $25, $26, $27,
      $28
    )
    ON CONFLICT (email) DO UPDATE SET
      fundly_id = EXCLUDED.fundly_id,
      email_sent_at = COALESCE(EXCLUDED.email_sent_at, fundly_leads.email_sent_at),
      contact_name = EXCLUDED.contact_name,
      phone = EXCLUDED.phone,
      background_info = EXCLUDED.background_info,
      can_contact = EXCLUDED.can_contact,
      use_of_funds = EXCLUDED.use_of_funds,
      location = EXCLUDED.location,
      urgency = EXCLUDED.urgency,
      time_in_business = EXCLUDED.time_in_business,
      bank_account = EXCLUDED.bank_account,
      annual_revenue = EXCLUDED.annual_revenue,
      industry = EXCLUDED.industry,
      looking_for = EXCLUDED.looking_for,
      looking_for_min = EXCLUDED.looking_for_min,
      looking_for_max = EXCLUDED.looking_for_max,
      urgency_code = COALESCE(EXCLUDED.urgency_code, fundly_leads.urgency_code),
      tib_months = COALESCE(EXCLUDED.tib_months, fundly_leads.tib_months),
      annual_revenue_min_usd = COALESCE(EXCLUDED.annual_revenue_min_usd, fundly_leads.annual_revenue_min_usd),
      annual_revenue_max_usd = COALESCE(EXCLUDED.annual_revenue_max_usd, fundly_leads.annual_revenue_max_usd),
      annual_revenue_usd_approx = COALESCE(EXCLUDED.annual_revenue_usd_approx, fundly_leads.annual_revenue_usd_approx),
      bank_account_bool = COALESCE(EXCLUDED.bank_account_bool, fundly_leads.bank_account_bool),
      use_of_funds_norm = COALESCE(EXCLUDED.use_of_funds_norm, fundly_leads.use_of_funds_norm),
      industry_norm = COALESCE(EXCLUDED.industry_norm, fundly_leads.industry_norm),
      created_at = CASE WHEN fundly_leads.created_at IS NULL THEN EXCLUDED.created_at ELSE fundly_leads.created_at END,
      filter_success = COALESCE(EXCLUDED.filter_success, fundly_leads.filter_success)
    RETURNING *;
  ` : `
    INSERT INTO fundly_leads (
      fundly_id, contact_name, email, phone, background_info, email_sent_at, created_at,
      can_contact, use_of_funds, location, urgency, time_in_business,
      bank_account, annual_revenue, industry, looking_for, looking_for_min, looking_for_max,
      urgency_code, tib_months, annual_revenue_min_usd, annual_revenue_max_usd, annual_revenue_usd_approx,
      bank_account_bool, use_of_funds_norm, industry_norm,
      filter_success
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
      $19, $20, $21, $22, $23, $24, $25, $26, $27,
      $28
    )
    ON CONFLICT (fundly_id) DO UPDATE SET
      email_sent_at = COALESCE(EXCLUDED.email_sent_at, fundly_leads.email_sent_at),
      contact_name = EXCLUDED.contact_name,
      phone = EXCLUDED.phone,
      background_info = EXCLUDED.background_info,
      can_contact = EXCLUDED.can_contact,
      use_of_funds = EXCLUDED.use_of_funds,
      location = EXCLUDED.location,
      urgency = EXCLUDED.urgency,
      time_in_business = EXCLUDED.time_in_business,
      bank_account = EXCLUDED.bank_account,
      annual_revenue = EXCLUDED.annual_revenue,
      industry = EXCLUDED.industry,
      looking_for = EXCLUDED.looking_for,
      looking_for_min = EXCLUDED.looking_for_min,
      looking_for_max = EXCLUDED.looking_for_max,
      urgency_code = COALESCE(EXCLUDED.urgency_code, fundly_leads.urgency_code),
      tib_months = COALESCE(EXCLUDED.tib_months, fundly_leads.tib_months),
      annual_revenue_min_usd = COALESCE(EXCLUDED.annual_revenue_min_usd, fundly_leads.annual_revenue_min_usd),
      annual_revenue_max_usd = COALESCE(EXCLUDED.annual_revenue_max_usd, fundly_leads.annual_revenue_max_usd),
      annual_revenue_usd_approx = COALESCE(EXCLUDED.annual_revenue_usd_approx, fundly_leads.annual_revenue_usd_approx),
      bank_account_bool = COALESCE(EXCLUDED.bank_account_bool, fundly_leads.bank_account_bool),
      use_of_funds_norm = COALESCE(EXCLUDED.use_of_funds_norm, fundly_leads.use_of_funds_norm),
      industry_norm = COALESCE(EXCLUDED.industry_norm, fundly_leads.industry_norm),
      created_at = CASE WHEN fundly_leads.created_at IS NULL THEN EXCLUDED.created_at ELSE fundly_leads.created_at END,
      filter_success = COALESCE(EXCLUDED.filter_success, fundly_leads.filter_success)
    RETURNING *;
  `;

  const result = await query(sql, [...commonValues, (lead as any).filter_success ?? null]);
  return result.rows[0] as FundlyLead;
}

export async function getLeadByEmail(email: string): Promise<FundlyLead | null> {
  const sql = 'SELECT * FROM fundly_leads WHERE email = $1';
  const result = await query(sql, [email]);
  return result.rows[0] as FundlyLead || null;
}

export async function getLeadByFundlyId(fundlyId: string): Promise<FundlyLead | null> {
  const sql = 'SELECT * FROM fundly_leads WHERE fundly_id = $1';
  const result = await query(sql, [fundlyId]);
  return result.rows[0] as FundlyLead || null;
}

export async function getAllLeads(): Promise<FundlyLead[]> {
  const sql = 'SELECT * FROM fundly_leads ORDER BY created_at DESC';
  const result = await query(sql);
  return result.rows as FundlyLead[];
}

export async function updateEmailSentAt(email: string, sentAt: Date): Promise<void> {
  const sql = 'UPDATE fundly_leads SET email_sent_at = $1 WHERE email = $2';
  await query(sql, [sentAt, email]);
}

export async function emailAlreadySent(email: string): Promise<boolean> {
  const sql = 'SELECT 1 FROM fundly_leads WHERE email = $1 AND email_sent_at IS NOT NULL LIMIT 1';
  const res = await query(sql, [email]);
  return (res.rowCount ?? 0) > 0;
}

export async function canContactByEmail(email: string): Promise<boolean> {
  const sql = 'SELECT can_contact FROM fundly_leads WHERE email = $1 ORDER BY created_at DESC LIMIT 1';
  const res = await query(sql, [email]);
  if (!(res.rowCount ?? 0)) return false;
  return !!res.rows[0].can_contact;
}
