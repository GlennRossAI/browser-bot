export interface FundlyLead {
  id?: number; // Database auto-increment ID
  fundly_id: string; // ID from Fundly system
  contact_name: string;
  email: string;
  phone: string;
  background_info: string;
  email_sent_at?: Date | null;
  created_at: string; // ISO timestamp
  can_contact: boolean;
  use_of_funds: string;
  location: string;
  urgency: string;
  time_in_business: string;
  bank_account: string;
  annual_revenue: string;
  industry: string;
  looking_for_min: string;
  looking_for_max: string;
  // Normalized columns (nullable if not backfilled)
  urgency_code?: string | null;
  tib_months?: number | null;
  annual_revenue_min_usd?: number | null;
  annual_revenue_max_usd?: number | null;
  annual_revenue_usd_approx?: number | null;
  bank_account_bool?: boolean | null;
  use_of_funds_norm?: string | null;
  industry_norm?: string | null;
  filter_success?: string | null;
}

export interface FundlyLeadInsert extends Omit<FundlyLead, 'id' | 'created_at'> {
  created_at?: string;
}
