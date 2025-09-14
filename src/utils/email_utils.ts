export function extractFirstEmail(text?: string | null): string | null {
  if (!text) return null;
  const cleaned = String(text)
    .replace(/\b(?:AM|PM)?\s*Archive\s*Summary\s*Activity\s*Email/gi, ' ')
    .replace(/\bExclusivityEmail\b/gi, ' ')
    .replace(/\bPhone\b/gi, ' ');
  const matches = Array.from(cleaned.matchAll(/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi));
  if (!matches.length) return null;
  let first = matches[0][1] || '';
  first = first.replace(/phone$/i, '');
  return first ? first.trim() : null;
}

export function isAllowedEmail(email?: string | null): boolean {
  if (!email) return false;
  const e = String(email).toLowerCase();
  if (e.includes('exclusivityemail')) return false;
  if (e.includes('giveyou.upphone')) return false;
  if (/@.*giveyou\.up\b/.test(e)) return false;
  if (e.endsWith('.phone') || /@.*phone\b/.test(e)) return false;
  return true;
}

export function sanitizeEmail(emailOrText?: string | null): string | null {
  const extracted = extractFirstEmail(emailOrText || '');
  if (!isAllowedEmail(extracted)) return null;
  return extracted ? extracted.toLowerCase() : null;
}

