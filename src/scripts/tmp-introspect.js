(async()=>{
  const { Client } = require('pg');
  const cs = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_0DN5UOYPQtZz@ep-winter-lake-ada0qmed-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';
  const c = new Client({ connectionString: cs, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const cols = await c.query("SELECT column_name,data_type,is_nullable FROM information_schema.columns WHERE table_name='fundly_leads' ORDER BY ordinal_position");
  console.log('COLUMNS');
  for (const r of cols.rows) console.log(r);
  const idx = await c.query("SELECT indexname,indexdef FROM pg_indexes WHERE tablename='fundly_leads'");
  console.log('\nINDEXES');
  for (const r of idx.rows) console.log(r);
  await c.end();
})().catch(e=>{ console.error(e); process.exit(1); });
