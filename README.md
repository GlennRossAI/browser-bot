# Browser Bot - Fundly Data Extraction

Playwright automation for extracting lead data from Fundly and saving to Neon database. Includes headless “scan once” runner, email sending (Gmail API preferred, SMTP fallback), inclusive multi-program filter logic, and a LaunchAgent to run every 15 seconds.

## Project Structure

```
├── src/
│   ├── types/              # TypeScript type definitions
│   │   └── lead.ts         # FundlyLead interface
│   ├── database/
│   │   ├── migrations/     # Database schema migrations
│   │   ├── queries/        # Database query functions
│   │   └── utils/         # Database connection utilities
│   ├── scripts/           # One-off utility scripts
│   │   ├── save-lead-to-db.ts    # Save JSON to database
│   │   └── run-migration.ts      # Run SQL migrations
│   └── tests/             # Playwright tests
│       └── Fundly-Run.spec.ts    # Main Fundly extraction test
├── data/                  # Extracted JSON data files
├── docs/                  # Documentation
└── test-results/          # Playwright test results
```

## Setup

1. Install dependencies:

```bash
pnpm install
# or npm install
npx playwright install chromium
```

2. Set up environment variables:

```bash
cp .env.example .env
# Edit .env with your DB, Fundly, and Email creds
```

3. Run database migrations:

```bash
pnpm run run-migration src/database/migrations/001_add_looking_for_columns.sql
pnpm run run-migration src/database/migrations/002_drop_looking_for_column.sql
pnpm run run-migration src/database/migrations/003_create_run_logs.sql
pnpm run run-migration src/database/migrations/004_add_looking_for_back.sql
pnpm run run-migration src/database/migrations/005_add_contact_name.sql
```

## Usage

### Extract Lead Data

```bash
# Run the Fundly extraction test
pnpm run test:fundly:headed

# Save extracted data to database
pnpm run save-lead
```

### Headless Scan-Once (save + optional email)

```bash
# Runs login -> add latest to pipeline (if available) -> open first lead
# -> extract + upsert to DB -> send email if new today and qualifies for any program
pnpm run scan
# Dry run (never sends or updates send state)
pnpm run scan:dry
# or
npx tsx src/scripts/scan-once.ts
```

### Migrations

Run migrations as needed (examples):

```bash
pnpm run run-migration src/database/migrations/001_add_looking_for_columns.sql
pnpm run run-migration src/database/migrations/002_drop_looking_for_column.sql
pnpm run run-migration src/database/migrations/004_add_looking_for_back.sql
pnpm run run-migration src/database/migrations/005_add_contact_name.sql
pnpm run run-migration src/database/migrations/006_drop_run_logs.sql  # removes DB run logs
```

### Database Operations

```bash
# Run a specific migration
pnpm run run-migration src/database/migrations/001_add_looking_for_columns.sql

# Save specific JSON file to database
pnpm run save-lead data/extracted-lead-data.json
```

## Email Sending

- Preferred: Gmail API (set `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REDIRECT_URI`, `GMAIL_REFRESH_TOKEN`, and optional `GMAIL_USER_EMAIL`).
- Fallback: SMTP (set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and optional `FROM_EMAIL`, `FROM_NAME`).
- Template: `src/email/general-template.html`.

## Database Schema

The `fundly_leads` table includes:

- Lead contact information (contact_name, email, phone)
- Lead details (location, urgency, industry, etc.)
- Funding requirements (looking_for_min, looking_for_max)
- Metadata (created_at, email_sent_at, can_contact)

Note: Database run-logs table was removed. Operational logs live under `logs/`.

## Environment Variables

- `DATABASE_URL` - Neon database connection string
- `FUNDLY_EMAIL` / `FUNDLY_PASSWORD` - Fundly credentials
- Gmail API: `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REDIRECT_URI`, `GMAIL_REFRESH_TOKEN`, optional `GMAIL_USER_EMAIL`
- SMTP: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, optional `FROM_EMAIL`, `FROM_NAME`

## LaunchAgent (macOS) — run every 15 seconds

The LaunchAgent is configured at `launchd/com.glenross.browserbot.plist` to run the scan-once script every 15 seconds, headless. It uses the project WorkingDirectory so `.env` is picked up.

```bash
mkdir -p ~/Library/LaunchAgents
cp launchd/com.glenross.browserbot.plist ~/Library/LaunchAgents/

# Reload it
launchctl unload -w ~/Library/LaunchAgents/com.glenross.browserbot.plist 2>/dev/null || true
launchctl load -w ~/Library/LaunchAgents/com.glenross.browserbot.plist

# Tail logs
tail -f logs/out.log logs/err.log

Additionally, JSONL logs are written to:

- `logs/app.ndjson` (info/debug)
- `logs/error.ndjson` (errors)
```

If you update the script or env, unload and load again to apply changes.

## Filters & Program Eligibility

The bot evaluates ALL qualification paths in `docs/requirements.md`. A lead passes if it matches at least one program based on fields we can scrape (annual revenue, time in business, urgency, bank account). Criteria like FICO and detailed documentation are validated later and do not block outreach.

- Urgency detection is case-insensitive and recognizes phrases like "ASAP", "Like Yesterday", "This Week", "This Month", "Within 30 days", and "Now".
- Baseline campaign requires: $10k+/month, >= 12 months in business, urgency within ~1 month, bank account present.
- Other programs (term loan, equipment financing, line of credit, SBA, bank LOC, working capital) are evaluated inclusively; if any matches, email is allowed (subject to new-today and prior-email checks).

## Email Safeguards & Runtime Controls

- Emails only send when `ALLOW_EMAIL_SEND=true` (set by the LaunchAgent). Manual runs do not send.
- Once an email is sent, `email_sent_at` is persisted and will not be overwritten by future upserts, preventing duplicate sends.
- Configure scan cadence via `SCAN_INTERVAL_SECONDS` (default 15). LaunchAgent sets this env to match its `StartInterval`.
- `DRY_RUN=true` fully disables sending and does not update `email_sent_at` — safe for local/manual testing.

Environment variables to control behavior:

- `ALLOW_EMAIL_SEND` — default `false`; set to `true` only in LaunchAgent env
- `RUN_CONTEXT` — optional; set to `launchd` in LaunchAgent
- `SCAN_INTERVAL_SECONDS` — default `15`; keep in sync with LaunchAgent `StartInterval`
- `DRY_RUN` — default `false`; set to `true` for manual/local dry runs

### Future: Email Send Ledger (optional)

If you later want multi-campaign control, provider receipts, and a full audit trail, consider a `send_ledger` table keyed by `(email, campaign)` with `sent_at`, `provider_message_id`, and `template_version`. Current behavior (“send once ever”) is enforced via `email_sent_at` and is sufficient for now.
