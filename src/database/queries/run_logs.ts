import { query } from '../utils/connection.js';

export interface RunLog {
  id: number;
  started_at: string;
  ended_at: string | null;
  status: string | null;
  discovered_count: number;
  saved_count: number;
  emailed_count: number;
  error_message: string | null;
  details: any;
}

export async function startRun(details?: any): Promise<RunLog> {
  const sql = `
    INSERT INTO browser_bot_run_logs (details)
    VALUES ($1)
    RETURNING *;
  `;
  const res = await query(sql, [details || null]);
  return res.rows[0] as RunLog;
}

export async function finishRun(id: number, patch: Partial<Omit<RunLog, 'id' | 'started_at'>>): Promise<RunLog> {
  const endedAt = new Date().toISOString();
  const sql = `
    UPDATE browser_bot_run_logs
    SET ended_at = $2,
        status = COALESCE($3, status),
        discovered_count = COALESCE($4, discovered_count),
        saved_count = COALESCE($5, saved_count),
        emailed_count = COALESCE($6, emailed_count),
        error_message = COALESCE($7, error_message),
        details = COALESCE($8, details)
    WHERE id = $1
    RETURNING *;
  `;
  const res = await query(sql, [
    id,
    endedAt,
    patch.status ?? null,
    patch.discovered_count ?? null,
    patch.saved_count ?? null,
    patch.emailed_count ?? null,
    patch.error_message ?? null,
    patch.details ?? null,
  ]);
  return res.rows[0] as RunLog;
}

