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

  queueLimit: 0,

  connectTimeout: 10000,

  enableKeepAlive: true,

  keepAliveInitialDelay: 0,

  charset: "utf8mb4",
});

console.log("======================================");
console.log("MYSQL POOL INITIALIZED");
console.log("Host:", process.env.DB_HOST);
console.log("Database:", process.env.MYSQL_DATABASE);
console.log("User:", process.env.MYSQL_USER);
console.log("Connection limit: 10");
console.log("======================================");

export async function testDatabaseConnection() {
  try {
    const connection = await pool.getConnection();

    try {
      await connection.query(
        "SELECT 1 AS database_test"
      );

      console.log(
        "✅ MySQL database connection successful"
      );
    } finally {
      connection.release();
    }

    return true;
  } catch (error) {
    console.error(
      "❌ MySQL database connection failed"
    );

    console.error(
      "Code:",
      error.code
    );

    console.error(
      "Message:",
      error.message
    );

    return false;
  }
}

export { pool };
