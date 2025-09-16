# LexingtonCap Fundly Lead Requirements (Implemented)

This document defines ALL qualification paths our bot evaluates. The bot emails a lead when it qualifies for at least one path below. Criteria we cannot scrape (e.g., FICO) are noted and validated later in the sales process.

## Baseline Campaign — Fast Funding

- Revenue: Monthly >= $10,000 (≈ Annual >= $120,000)
- Time in Business: >= 12 months
- Urgency: within ~1 month (e.g., "ASAP", "Like Yesterday", "This Week", "This Month")
- Bank Account: business account present
- Documentation: 4 months statements, soft pull (validated later)

## Program Paths

### Business Term Loan
- Time in Business: >= 24 months
- Annual Revenue: >= $250,000
- FICO: 650+ (collected later)
- Paperwork: 1-page app, 6 months bank statements, 2 years business tax, 1 year personal tax

### Equipment Financing
- Time in Business: no minimum
- Annual Revenue: no minimum
- FICO: 600+ (collected later)
- Paperwork: 1-page app, 6 months bank statements or equipment invoice/quote

### Line of Credit
- Time in Business: >= 6 months
- Annual Revenue: >= $120,000
- FICO: 600+ (collected later)
- Paperwork: 1-page app, 4 months bank statements

### SBA Loan
- Time in Business: >= 24 months
- Annual Revenue: >= $120,000
- FICO: 675+ (collected later)
- Paperwork: 1-page app, 6 months bank/personal returns, 2 years business tax, YTD P&L + balance sheet, debt schedule

### Bank Line of Credit
- Time in Business: >= 36 months
- Annual Revenue: >= $350,000 (proxy for tax return gross)
- FICO: 700+ (collected later)
- Paperwork: 1-page app, 4 months bank statements, tri-merge credit

### Working Capital Loan
- Time in Business: >= 3 months
- Annual Revenue: >= $100,000
- FICO: no minimum
- Paperwork: 1-page app, 4 months bank statements

Notes
- FICO and specific document checks are deferred until later in the funnel and do not block email outreach.
- If at least one program’s data-driven criteria match, the bot proceeds with email (subject to “new today” and prior-email checks).
