import { FundlyLead } from '../types/lead.js';

function parseCurrency(text: string | undefined | null): number | null {
  if (!text) return null;
  const cleaned = String(text).replace(/[,\s]/g, '');
  const m = cleaned.match(/\$?(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

function monthsFromText(text: string | undefined | null): number | null {
  if (!text) return null;
  const t = text.toLowerCase();
  if (/\b(1\s*[-–]\s*2|1\+?|at\s*least\s*1)\s*year/.test(t)) return 12;
  if (/\b2\s*[-–]\s*5\s*years|2\+\s*years/.test(t)) return 24; // at least
  if (/\b5\s*[-–]\s*10\s*years|5\+\s*years/.test(t)) return 60;
  if (/\b10\+?\s*years?/.test(t)) return 120;
  if (/\b(\d+)\s*months?/.test(t)) return Number(RegExp.$1);
  if (/\b(\d+)\s*years?/.test(t)) return Number(RegExp.$1) * 12;
  return null;
}

function urgencyWithinOneMonth(urgency: string | undefined | null): boolean {
  if (!urgency) return false;
  const t = urgency.toLowerCase();
  return /(asap|this\s*week|this\s*month|within\s*30\s*days|<\s*1\s*month|\bnow\b)/.test(t);
}

export function passesRequirements(lead: Pick<FundlyLead, 'annual_revenue' | 'time_in_business' | 'urgency' | 'bank_account' | 'background_info'>): boolean {
  const annual = parseCurrency(lead.annual_revenue) || 0;
  const monthlyFromAnnual = annual > 0 ? annual / 12 : 0;
  const timeMonths = monthsFromText(lead.time_in_business) || 0;
  const monthlyOk = monthlyFromAnnual >= 20000; // >= $20k monthly
  const tibOk = timeMonths >= 12; // >= 1 year
  const urgencyOk = urgencyWithinOneMonth(lead.urgency);
  const bankOk = (lead.bank_account || '').toLowerCase().includes('yes') || (lead.bank_account || '').trim() !== '';

  // Documentation (4 months statements, soft pull) cannot be reliably inferred from scraped fields yet.
  // We treat them as neutral and focus on the core qualifiers above.
  return monthlyOk && tibOk && urgencyOk && bankOk;
}

