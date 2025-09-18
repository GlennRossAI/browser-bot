import pg from 'pg';
const { Client } = pg;
const cs = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_0DN5UOYPQtZz@ep-winter-lake-ada0qmed-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';
const c = new Client({ connectionString: cs, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query("UPDATE fundly_leads SET phone=NULL WHERE phone IS NOT NULL AND lower(btrim(phone)) LIKE 'locked%'");
const r = await c.query("SELECT count(*)::int AS c FROM fundly_leads WHERE phone IS NOT NULL AND lower(btrim(phone)) LIKE 'locked%'");
console.log('remainingLockedPhone', r.rows[0].c);
await c.end();
