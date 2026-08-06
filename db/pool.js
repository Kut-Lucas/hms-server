// import '../loadEnv.js';
// import mysql from 'mysql2/promise';

// export const pool = mysql.createPool({
//   host: process.env.DB_HOST || "hms-db-2cch",
//   user: process.env.MYSQL_USER || "kut",
//   password: process.env.MYSQL_PASSWORD || "",
//   database: process.env.MYSQL_DATABASE || "hms_db",
//   waitForConnections: true,
//   connectionLimit: 10,
//   queueLimit: 0,
//   enableKeepAlive: true,
//   keepAliveInitialDelay: 0,
// });

import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,

  waitForConnections: true,
  connectionLimit: 10,

  // Was 0 (= unlimited queueing). Unlimited queueing is exactly why
  // your login request hung silently instead of failing fast: once
  // all 10 connections were stuck/leaked, new queries just queued
  // forever with no error, until axios's 30s timeout gave up client-side.
  queueLimit: 20,

  connectTimeout: 10000,

  // NEW: kill/recycle connections that have been idle too long so a
  // provider-killed socket never gets reused and hangs on the next query.
  idleTimeout: 60000, // ms a connection can sit idle in the pool
  maxIdle: 10, // max idle connections kept around

  enableKeepAlive: true,
  keepAliveInitialDelay: 0,

  charset: "utf8mb4",
});

console.log("======================================");
console.log("MYSQL POOL INITIALIZED");
console.log("Host:", process.env.DB_HOST);
console.log("Database:", process.env.MYSQL_DATABASE);
console.log("User:", process.env.MYSQL_USER);
console.log("======================================");

export async function testDatabaseConnection() {
  try {
    const connection = await pool.getConnection();
    try {
      await connection.query("SELECT 1 AS database_test");
      console.log("✅ MySQL database connection successful");
    } finally {
      connection.release();
    }
    return true;
  } catch (error) {
    console.error("❌ MySQL database connection failed");
    console.error("Code:", error.code);
    console.error("Message:", error.message);
    return false;
  }
}

// NEW: periodic keep-alive ping. Detects/recycles dead connections
// proactively every 4 minutes instead of letting a real user request
// discover a stale socket and hang on it.
setInterval(
  () => {
    testDatabaseConnection().catch(() => {});
  },
  4 * 60 * 1000,
);

export { pool };