export interface BackoffOptions {
  maxRetries?: number;
  baseMs?: number;
  factor?: number;
  jitter?: number; // 0..1
  label?: string;
}

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

function isTransient(e: unknown): boolean {
  const msg = String((e as any)?.message || e || '').toLowerCase();
  return (
    msg.includes('429') ||
    msg.includes('too many requests') ||
    msg.includes('rate limit') ||
    msg.includes('timeout') ||
    msg.includes('timed out')
  );
}

export async function withBackoff<T>(fn: () => Promise<T>, opts: BackoffOptions = {}): Promise<T> {
  const maxRetries = opts.maxRetries ?? 5;
  const base = opts.baseMs ?? 500;
  const factor = opts.factor ?? 2;
  const jitter = opts.jitter ?? 0.2;
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn();
    } catch (e) {
      attempt++;
      if (attempt > maxRetries || !isTransient(e)) throw e;
      const delay = Math.round((base * Math.pow(factor, attempt - 1)) * (1 + (Math.random() - 0.5) * 2 * jitter));
      // small console-only note; main logging handled by callers if needed
      // console.log(`backoff(${opts.label || 'op'}) attempt ${attempt}/${maxRetries} sleeping ${delay}ms:`, e);
      await sleep(delay);
    }
  }
}

