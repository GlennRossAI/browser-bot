export const SCAN_INTERVAL_SECONDS = Number(process.env.SCAN_INTERVAL_SECONDS || 15);
export const ALLOW_EMAIL_SEND = String(process.env.ALLOW_EMAIL_SEND || '').toLowerCase() === 'true';
export const RUN_CONTEXT = process.env.RUN_CONTEXT || '';
export const DRY_RUN = String(process.env.DRY_RUN || '').toLowerCase() === 'true';

export function emailSendingEnabled(): boolean {
  // Hard-stop in dry-run mode
  if (DRY_RUN) return false;
  // Only allow when explicitly enabled (e.g., by LaunchAgent)
  if (ALLOW_EMAIL_SEND) return true;
  // Optional alternate flag if plist sets RUN_CONTEXT=launchd
  if (RUN_CONTEXT.toLowerCase() === 'launchd') return true;
  return false;
}
