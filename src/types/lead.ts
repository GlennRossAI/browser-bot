export interface FundlyLead {
  id?: number; // Database auto-increment ID
  fundly_id: string; // ID from Fundly system
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
}

export interface FundlyLeadInsert extends Omit<FundlyLead, 'id' | 'created_at'> {
  created_at?: string;
}