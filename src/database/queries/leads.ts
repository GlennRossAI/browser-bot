import { query } from '../utils/connection.js';
import { FundlyLead, FundlyLeadInsert } from '../../types/lead.js';

export async function insertLead(lead: FundlyLeadInsert): Promise<FundlyLead> {
  const sql = `
    INSERT INTO fundly_leads (
      fundly_id, email, phone, background_info, email_sent_at, created_at,
      can_contact, use_of_funds, location, urgency, time_in_business,
      bank_account, annual_revenue, industry, looking_for_min, looking_for_max
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
    )
    ON CONFLICT (email) DO UPDATE SET
      fundly_id = EXCLUDED.fundly_id,
      phone = EXCLUDED.phone,
      background_info = EXCLUDED.background_info,
      email_sent_at = EXCLUDED.email_sent_at,
      can_contact = EXCLUDED.can_contact,
      use_of_funds = EXCLUDED.use_of_funds,
      location = EXCLUDED.location,
      urgency = EXCLUDED.urgency,
      time_in_business = EXCLUDED.time_in_business,
      bank_account = EXCLUDED.bank_account,
      annual_revenue = EXCLUDED.annual_revenue,
      industry = EXCLUDED.industry,
      looking_for_min = EXCLUDED.looking_for_min,
      looking_for_max = EXCLUDED.looking_for_max,
      created_at = CASE WHEN fundly_leads.created_at IS NULL THEN EXCLUDED.created_at ELSE fundly_leads.created_at END
    RETURNING *;
  `;

  const values = [
    lead.fundly_id,
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
    lead.looking_for_min,
    lead.looking_for_max
  ];

  const result = await query(sql, values);
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