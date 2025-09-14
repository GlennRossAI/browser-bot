#!/usr/bin/env tsx

/**
 * Script to run database migrations
 * Usage: tsx src/scripts/run-migration.ts [migration-file]
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { query, closePool } from '../database/utils/connection.js';

async function main() {
  const migrationFile = process.argv[2];

  if (!migrationFile) {
    console.error('❌ Please provide a migration file path');
    console.log('Usage: tsx src/scripts/run-migration.ts <migration-file>');
    process.exit(1);
  }

  const fullPath = resolve(process.cwd(), migrationFile);

  try {
    console.log(`🔄 Running migration: ${fullPath}`);
    const migrationSql = readFileSync(fullPath, 'utf8');

    await query(migrationSql);

    console.log('✅ Migration completed successfully!');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await closePool();
  }
}

try {
  const { pathToFileURL } = await import('url');
  const invoked = pathToFileURL(process.argv[1]).href;
  if (import.meta.url === invoked) {
    main();
  }
} catch {
  main();
}
