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
  // Accept common urgent phrases, including "like yesterday"
  return /(asap|this\s*week|this\s*month|within\s*30\s*days|<\s*1\s*month|\bnow\b|like\s*yesterday)/.test(t);
}

function hasBankAccount(text: string | undefined | null): boolean {
  if (!text) return false;
  const t = text.toLowerCase();
  // treat any non-empty non-negative response as truthy if it includes yes/y
  if (/\b(yes|y)\b/.test(t)) return true;
  if (/\b(no|n)\b/.test(t)) return false;
  return t.trim().length > 0; // unknown but present
}

export type ProgramKey =
  | 'first_campaign'
  | 'business_term_loan'
  | 'equipment_financing'
  | 'line_of_credit'
  | 'sba_loan'
  | 'bank_loc'
  | 'working_capital';

export interface ProgramResult {
  key: ProgramKey;
  eligible: boolean;
  reasons: string[]; // positive notes and blockers
}

export interface EvaluationResult {
  anyQualified: boolean;
  programs: ProgramResult[];
}

export function evaluatePrograms(
  lead: Pick<FundlyLead, 'annual_revenue' | 'time_in_business' | 'urgency' | 'bank_account' | 'background_info'>
): EvaluationResult {
  const annual = parseCurrency(lead.annual_revenue) || 0;
  const monthlyFromAnnual = annual > 0 ? annual / 12 : 0;
  const timeMonths = monthsFromText(lead.time_in_business) || 0;
  const bankOk = hasBankAccount(lead.bank_account);

  const programs: ProgramResult[] = [];

  // First Test Campaign (baseline) — updated per docs: $10k+ monthly, >= 12 months, urgency <= 1 month, bank account present
  {
    const reasons: string[] = [];
    const monthlyOk = monthlyFromAnnual >= 10000; // >= $10k monthly per docs
    const tibOk = timeMonths >= 12;
    const urgencyOk = urgencyWithinOneMonth(lead.urgency);
    if (!monthlyOk) reasons.push(`Needs >= $10k monthly (has ~$${Math.round(monthlyFromAnnual).toLocaleString()}/mo)`);
    if (!tibOk) reasons.push(`Needs >= 12 months in business (has ${timeMonths}m)`);
    if (!urgencyOk) reasons.push('Urgency must be within ~1 month');
    if (!bankOk) reasons.push('Business bank account not confirmed');
    const eligible = monthlyOk && tibOk && urgencyOk && bankOk;
    programs.push({ key: 'first_campaign', eligible, reasons });
  }

  // Business Term Loan — 24m+, $250k+ annual; FICO 650+ (unknown from scrape)
  {
    const reasons: string[] = [];
    const tibOk = timeMonths >= 24;
    const revOk = annual >= 250_000;
    if (!tibOk) reasons.push(`Needs >= 24 months in business (has ${timeMonths}m)`);
    if (!revOk) reasons.push(`Needs >= $250k annual (has ~$${Math.round(annual).toLocaleString()})`);
    // FICO unknown -> note informational only
    reasons.push('FICO 650+ required (not collected)');
    const eligible = tibOk && revOk; // treat FICO as unknown, evaluated later
    programs.push({ key: 'business_term_loan', eligible, reasons });
  }

  // Equipment Financing — no min TIB or revenue; FICO 600+ (unknown)
  {
    const reasons: string[] = [];
    reasons.push('FICO 600+ preferred (not collected)');
    const eligible = true; // broadly inclusive
    programs.push({ key: 'equipment_financing', eligible, reasons });
  }

  // Line of Credit — 6m+, $120k+ annual; FICO 600+
  {
    const reasons: string[] = [];
    const tibOk = timeMonths >= 6;
    const revOk = annual >= 120_000;
    if (!tibOk) reasons.push(`Needs >= 6 months in business (has ${timeMonths}m)`);
    if (!revOk) reasons.push(`Needs >= $120k annual (has ~$${Math.round(annual).toLocaleString()})`);
    reasons.push('FICO 600+ required (not collected)');
    const eligible = tibOk && revOk;
    programs.push({ key: 'line_of_credit', eligible, reasons });
  }

  // SBA Loan — 24m+, $120k+ annual; FICO 675+
  {
    const reasons: string[] = [];
    const tibOk = timeMonths >= 24;
    const revOk = annual >= 120_000;
    if (!tibOk) reasons.push(`Needs >= 24 months in business (has ${timeMonths}m)`);
    if (!revOk) reasons.push(`Needs >= $120k annual (has ~$${Math.round(annual).toLocaleString()})`);
    reasons.push('FICO 675+ required (not collected)');
    const eligible = tibOk && revOk;
    programs.push({ key: 'sba_loan', eligible, reasons });
  }

  // Bank Line of Credit — 36m+, $350k+ on business tax return; FICO 700+
  {
    const reasons: string[] = [];
    const tibOk = timeMonths >= 36;
    const revOk = annual >= 350_000;
    if (!tibOk) reasons.push(`Needs >= 36 months in business (has ${timeMonths}m)`);
    if (!revOk) reasons.push(`Needs >= $350k annual (has ~$${Math.round(annual).toLocaleString()})`);
    reasons.push('FICO 700+ required (not collected)');
    const eligible = tibOk && revOk;
    programs.push({ key: 'bank_loc', eligible, reasons });
  }

  // Working Capital Loan — 3m+, $100k+ annual; no FICO minimum
  {
    const reasons: string[] = [];
    const tibOk = timeMonths >= 3;
    const revOk = annual >= 100_000;
    if (!tibOk) reasons.push(`Needs >= 3 months in business (has ${timeMonths}m)`);
    if (!revOk) reasons.push(`Needs >= $100k annual (has ~$${Math.round(annual).toLocaleString()})`);
    const eligible = tibOk && revOk;
    programs.push({ key: 'working_capital', eligible, reasons });
  }

  // Overall eligibility: any program qualifies OR baseline campaign qualifies
  const anyQualified = programs.some(p => p.eligible);
  return { anyQualified, programs };
}

export function passesRequirements(
  lead: Pick<FundlyLead, 'annual_revenue' | 'time_in_business' | 'urgency' | 'bank_account' | 'background_info'>
): boolean {
  const evalRes = evaluatePrograms(lead);
  return evalRes.anyQualified;
}
