import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL ||
  'postgresql://neondb_owner:npg_0DN5UOYPQtZz@ep-winter-lake-ada0qmed-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

export const pool = new Pool({
  connectionString,
  ssl: {
    rejectUnauthorized: false
  }
});

export async function query(text: string, params?: any[]) {
  const client = await pool.connect();
  try {
    const result = await client.query(text, params);
    return result;
  } finally {
    client.release();
  }
}

export async function closePool() {
  await pool.end();
}