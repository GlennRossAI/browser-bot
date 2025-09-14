import fs from 'fs';
import path from 'path';

const logsDir = path.resolve(process.cwd(), 'logs');
const appLog = path.join(logsDir, 'app.ndjson');
const errLog = path.join(logsDir, 'error.ndjson');

function ensureLogsDir() {
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
}

function writeLine(file: string, obj: Record<string, unknown>) {
  try {
    ensureLogsDir();
    fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ...obj }) + '\n');
  } catch {}
}

export function logMsg(message: string, meta?: Record<string, unknown>) {
  const payload = { level: 'info', msg: message, ...(meta || {}) };
  console.log(`[INFO] ${message}`, meta || '');
  writeLine(appLog, payload);
}

export function logVar(name: string, value: unknown) {
  const payload = { level: 'debug', var: name, value } as Record<string, unknown>;
  console.log(`[DBG] ${name}`, value);
  writeLine(appLog, payload);
}

export function logError(err: unknown, meta?: Record<string, unknown>) {
  const message = (err as Error)?.message || String(err);
  const payload = { level: 'error', msg: message, stack: (err as Error)?.stack, ...(meta || {}) };
  console.error(`[ERR] ${message}`);
  writeLine(errLog, payload);
}

