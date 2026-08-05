import '../loadEnv.js';
import mysql from 'mysql2/promise';

export const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.MYSQL_USER || 'kut',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'hms_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});
