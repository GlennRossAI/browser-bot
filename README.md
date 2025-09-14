# Browser Bot - Fundly Data Extraction

Playwright automation for extracting lead data from Fundly and saving to Neon database.

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
```

2. Set up environment variables:

```bash
cp .env.example .env
# Edit .env with your credentials
```

3. Run database migrations:

```bash
pnpm run run-migration src/database/migrations/001_add_looking_for_columns.sql
```

## Usage

### Extract Lead Data

```bash
# Run the Fundly extraction test
pnpm run test:fundly:headed

# Save extracted data to database
pnpm run save-lead
```

### Database Operations

```bash
# Run a specific migration
pnpm run run-migration src/database/migrations/001_add_looking_for_columns.sql

# Save specific JSON file to database
pnpm run save-lead data/extracted-lead-data.json
```

## Database Schema

The `fundly_leads` table includes:

- Lead contact information (email, phone)
- Lead details (location, urgency, industry, etc.)
- Funding requirements (looking_for_min, looking_for_max)
- Metadata (created_at, email_sent_at, can_contact)

## Environment Variables

- `DATABASE_URL` - Neon database connection string
- `FUNDLY_EMAIL` - Fundly login email
- `FUNDLY_PASSWORD` - Fundly login password
