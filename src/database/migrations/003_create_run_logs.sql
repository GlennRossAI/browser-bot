-- Track each browser-bot run execution and summary
CREATE TABLE IF NOT EXISTS browser_bot_run_logs (
  id BIGSERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  status TEXT, -- success | failure
  discovered_count INTEGER DEFAULT 0,
  saved_count INTEGER DEFAULT 0,
  emailed_count INTEGER DEFAULT 0,
  error_message TEXT,
  details JSONB
);

