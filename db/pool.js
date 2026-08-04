import '../loadEnv.js';
import mysql from 'mysql2/promise';

export const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'kut',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'hms_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});
