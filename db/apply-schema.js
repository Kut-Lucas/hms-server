/**
 * Create hms_db and apply database/schema.sql using credentials from server/.env.
 * Run: node server/db/apply-schema.js   (from repo root) or  node db/apply-schema.js  (from server/)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import '../loadEnv.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(__dirname, '..', '..', 'database', 'schema.sql');

async function main() {
  if (!fs.existsSync(schemaPath)) {
    console.error('Schema file not found:', schemaPath);
    process.exit(1);
  }
  const sql = fs.readFileSync(schemaPath, 'utf8');
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.MYSQL_USER || 'kut',
    password: process.env.MYSQL_PASSWORD || '',
    multipleStatements: true,
  });
  console.log('Applying schema (this may take a few seconds)...');
  await conn.query(sql);
  await conn.end();
  console.log('Done. Database hms_db is ready.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
