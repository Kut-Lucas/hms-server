/**
 * Diagnose MySQL connectivity using the same .env as the API (server/.env).
 * Run from repo root: node server/db/test-connection.js
 * Or from server:    node db/test-connection.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env');

dotenv.config({ path: envPath });

const user = process.env.DB_USER || 'kut';
const password = process.env.DB_PASSWORD ?? '';
const database = process.env.DB_NAME || 'hms_db';
const hostsToTry = [...new Set([process.env.DB_HOST || 'localhost', '127.0.0.1', 'localhost'])];

console.log('\n=== MySQL connection test ===');
console.log('.env path:', envPath);
console.log('.env exists:', fs.existsSync(envPath));
console.log('DB_USER:', user);
console.log('DB_NAME:', database);
console.log('DB_PASSWORD length:', password.length, '(0 means empty — MySQL will reject if that user requires a password)\n');

async function tryConnect(host, withDb) {
  const cfg = {
    host,
    user,
    password,
    connectTimeout: 8000,
  };
  if (withDb) cfg.database = database;
  const conn = await mysql.createConnection(cfg);
  await conn.ping();
  await conn.end();
  return true;
}

let lastErr = null;
for (const host of hostsToTry) {
  for (const withDb of [false, true]) {
    const label = `${host} ${withDb ? `+ database "${database}"` : '(no database)'}`;
    try {
      await tryConnect(host, withDb);
      console.log('OK:', label);
      if (!withDb) continue;
      console.log('\nYou can use in server/.env:');
      console.log(`DB_HOST=${host}`);
      console.log('Restart the API after saving.\n');
      process.exit(0);
    } catch (e) {
      lastErr = e;
      console.log('FAIL:', label);
      console.log('     ', e.code || e.errno, e.sqlMessage || e.message);
    }
  }
}

console.log('\n--- Could not connect ---');
if (lastErr) {
  console.log('Last error:', lastErr.code, lastErr.sqlMessage || lastErr.message);
}
console.log('\nFix checklist:');
console.log('1. MySQL service is running (Services app / XAMPP / Workbench).');
console.log('2. server/.env has DB_USER and DB_PASSWORD matching a real MySQL account (password required for most users).');
console.log('3. Special characters in password: use quotes, e.g. DB_PASSWORD="p@ss#word"');
console.log('4. Create DB and tables: mysql -u ... -p < database/schema.sql');
console.log('5. Try DB_HOST=127.0.0.1 if localhost fails on Windows.\n');
process.exit(1);
