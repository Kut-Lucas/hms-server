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
  queueLimit: 20, // Prevents memory leaks / infinite hangs when pool is exhausted

  // FIX 1: Set explicit 10s TCP keep-alive delay (0 can disable it on some TCP stacks)
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,

  // Handshake timeout
  connectTimeout: 10000,

  // Recycle idle connections before Render's proxy kills them
  idleTimeout: 60000,
  maxIdle: 10,

  charset: "utf8mb4",
});

// FIX 2: Attach pool error handler to evict dead sockets without crashing Node
pool.on("error", (err) => {
  console.error("⚠️ Unexpected MySQL Pool Error:", err.code || err.message);
  if (
    err.code === "PROTOCOL_CONNECTION_LOST" ||
    err.code === "PROTOCOL_SEQUENCE_TIMEOUT" ||
    err.code === "ECONNRESET"
  ) {
    console.warn("Evicting stale/broken connection from pool...");
  }
});

/*
|--------------------------------------------------------------------------
| FIX 3: Resilient execute() — stale pooled connections silently hang
|--------------------------------------------------------------------------
|
| mysql2's pool releases a connection back to the free list even after a
| query on it fails, so a single stale/dead socket (e.g. dropped by a
| network proxy while idle) keeps getting handed to the next request and
| hanging forever, since only queries that pass an explicit `timeout`
| ever fail instead of hanging. This wraps every pool.execute() call with
| a default timeout and, on a connection-level failure, destroys the bad
| connection (instead of recycling it) and retries once on a fresh one.
*/

const DEFAULT_QUERY_TIMEOUT = 8000;

const RETRYABLE_CODES = new Set([
  "PROTOCOL_CONNECTION_LOST",
  "PROTOCOL_SEQUENCE_TIMEOUT",
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "EPIPE",
]);

pool.execute = async (sqlOrOptions, params = []) => {
  const isOptionsForm =
    typeof sqlOrOptions === "object" && sqlOrOptions !== null;

  const sql = isOptionsForm ? sqlOrOptions.sql : sqlOrOptions;
  const timeout = isOptionsForm
    ? (sqlOrOptions.timeout ?? DEFAULT_QUERY_TIMEOUT)
    : DEFAULT_QUERY_TIMEOUT;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const connection = await pool.getConnection();

    try {
      const result = await connection.execute({ sql, timeout }, params);
      connection.release();
      return result;
    } catch (err) {
      const retryable =
        RETRYABLE_CODES.has(err.code) || /timeout/i.test(err.message || "");

      if (retryable) {
        connection.destroy();
      } else {
        connection.release();
      }

      if (!retryable || attempt === 2) {
        throw err;
      }

      console.warn(
        "Retrying query after stale connection error:",
        err.code || err.message,
      );
    }
  }
};

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

// Periodic keep-alive ping (runs every 4 minutes)
const pingInterval = setInterval(
  () => {
    testDatabaseConnection().catch(() => {});
  },
  4 * 60 * 1000,
);

// Prevent this interval from holding the Node process open during graceful shutdown
if (pingInterval.unref) {
  pingInterval.unref();
}

export { pool };