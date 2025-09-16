export type UrgencyCode = 'asap' | 'like_yesterday' | 'this_week' | 'this_month' | 'within_30_days' | 'now' | 'unknown';

export function normalizeUrgency(text?: string | null): UrgencyCode {
  const t = (text || '').toLowerCase().trim();
  if (!t) return 'unknown';
  if (/\basap\b/.test(t)) return 'asap';
  if (/like\s*yesterday/.test(t)) return 'like_yesterday';
  if (/this\s*week/.test(t)) return 'this_week';
  if (/this\s*month/.test(t)) return 'this_month';
  if (/within\s*30\s*days|<\s*1\s*month/.test(t)) return 'within_30_days';
  if (/\bnow\b/.test(t)) return 'now';
  return 'unknown';
}

export function parseTibMonths(text?: string | null): number | null {
  const s = (text || '').toLowerCase();
  if (!s) return null;
  const mY = s.match(/(\d+)\s*years?/);
  const mM = s.match(/(\d+)\s*months?/);
  if (/10\s*\+/.test(s)) return 120;
  if (/5\s*[-–]\s*10\s*years?/.test(s)) return 60;
  if (/2\s*[-–]\s*5\s*years?/.test(s)) return 24;
  if (/1\s*[-–]\s*2\s*years?/.test(s)) return 12;
  if (mM) return Number(mM[1]);
  if (mY) return Number(mY[1]) * 12;
  return null;
}

function parseCurrencyToken(token: string): number | null {
  const m = token.toLowerCase().replace(/[,\s]/g, '').match(/^\$?([0-9]+(?:\.[0-9]+)?)([km])?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  const suf = (m[2] || '').toLowerCase();
  if (suf === 'k') return n * 1_000;
  if (suf === 'm') return n * 1_000_000;
  return n;
}

export function parseRevenueRange(text?: string | null): { min: number | null; max: number | null; approx: number | null } {
  if (!text) return { min: null, max: null, approx: null };
  const matches = [...String(text).matchAll(/\$?([0-9][0-9,\.]*)(\s*[km])?/gi)]
    .map((m) => parseCurrencyToken((m[1] || '') + (m[2] || '')))
    .filter((n): n is number => typeof n === 'number');
  if (!matches.length) return { min: null, max: null, approx: null };
  const min = Math.min(...matches);
  const max = Math.max(...matches);
  const approx = matches.length > 1 ? Math.round((min + max) / 2) : min;
  return { min, max, approx };
}

export function normalizeUseOfFunds(text?: string | null): string {
  const t = (text || '').toLowerCase();
  if (/equip/.test(t)) return 'equipment';
  if (/payroll/.test(t)) return 'payroll';
  if (/expan/.test(t)) return 'expansion';
  if (/debt|refi|refinanc/.test(t)) return 'debt_refi';
  if (!t) return 'other';
  return 'other';
}

export function normalizeBankAccount(text?: string | null): boolean | null {
  if (text == null) return null;
  const t = String(text).toLowerCase();
  if (/\by(es)?\b|business|checking/.test(t)) return true;
  if (/\bn(o)?\b|none|no\s*account/.test(t)) return false;
  return null;
}

