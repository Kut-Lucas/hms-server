// import './loadEnv.js';
// import express from 'express';
// import cors from 'cors';
// import helmet from 'helmet';
// import morgan from 'morgan';
// import cookieParser from 'cookie-parser';

// import { authMiddleware } from './middleware/auth.js';

// import authRoutes from './routes/authRoutes.js';
// import adminRoutes from './routes/adminRoutes.js';
// import patientRoutes from './routes/patientRoutes.js';
// import visitRoutes from './routes/visitRoutes.js';
// import triageRoutes from './routes/triageRoutes.js';
// import doctorRoutes from './routes/doctorRoutes.js';
// import labRoutes from './routes/labRoutes.js';
// import pharmacyRoutes from './routes/pharmacyRoutes.js';
// import inventoryRoutes from './routes/inventoryRoutes.js';
// import financeRoutes from './routes/financeRoutes.js';

// const app = express();
// const PORT = process.env.PORT || 5000;
// const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
// const allowedOrigins = [
//   ...new Set([
//     clientUrl,
//     'http://localhost:5173',
//     'http://127.0.0.1:5173',
//     'http://192.168.0.105:5173',
//   ]),
// ].filter(Boolean);

// app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
// app.use(morgan('dev'));
// app.use(cookieParser());
// app.use(express.json());
// app.use(
//   cors({
//     origin(origin, callback) {
//       if (!origin || allowedOrigins.includes(origin)) {
//         return callback(null, true);
//       }
//       return callback(null, false);
//     },
//     credentials: true,
//   })
// );

// app.get('/api/health', (req, res) => res.json({ ok: true }));

// app.use('/api/auth', authRoutes);
// app.use('/api/admin', authMiddleware, adminRoutes);
// app.use('/api/patients', authMiddleware, patientRoutes);
// app.use('/api/visits', authMiddleware, visitRoutes);
// app.use('/api/triage', authMiddleware, triageRoutes);
// app.use('/api/doctor', authMiddleware, doctorRoutes);
// app.use('/api/lab', authMiddleware, labRoutes);
// app.use('/api/pharmacy', authMiddleware, pharmacyRoutes);
// app.use('/api/inventory', authMiddleware, inventoryRoutes);
// app.use('/api/finance', authMiddleware, financeRoutes);

// app.use((err, req, res, next) => {
//   console.error(err);
//   res.status(500).json({ success: false, message: 'Internal server error' });
// });

// app.listen(PORT, '0.0.0.0', () => {
//   console.log(`HMS API listening on http://localhost:${PORT} (and http://192.168.0.105:${PORT} on your LAN)`);
// });

import "./loadEnv.js";

import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";

import { pool } from "./db/pool.js";
import { authMiddleware } from "./middleware/auth.js";

import authRoutes from "./routes/authRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import patientRoutes from "./routes/patientRoutes.js";
import visitRoutes from "./routes/visitRoutes.js";
import triageRoutes from "./routes/triageRoutes.js";
import doctorRoutes from "./routes/doctorRoutes.js";
import labRoutes from "./routes/labRoutes.js";
import pharmacyRoutes from "./routes/pharmacyRoutes.js";
import inventoryRoutes from "./routes/inventoryRoutes.js";
import financeRoutes from "./routes/financeRoutes.js";

const app = express();

/*
|--------------------------------------------------------------------------
| SERVER CONFIGURATION
|--------------------------------------------------------------------------
*/

const PORT = Number(process.env.PORT) || 5000;

const CLIENT_URL =
  process.env.CLIENT_URL ||
  "https://hms-client-1.onrender.com";

const allowedOrigins = [
  CLIENT_URL,
  "https://hms-client-1.onrender.com",

  // Local development
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://192.168.0.105:5173",
];

const uniqueOrigins = [
  ...new Set(
    allowedOrigins
      .filter(Boolean)
      .map((origin) => origin.replace(/\/$/, ""))
  ),
];

console.log("");
console.log("======================================");
console.log("        HMS SERVER CONFIGURATION");
console.log("======================================");
console.log("PORT:", PORT);
console.log("NODE_ENV:", process.env.NODE_ENV || "development");
console.log("CLIENT_URL:", CLIENT_URL);
console.log("ALLOWED ORIGINS:", uniqueOrigins);
console.log("DATABASE HOST:", process.env.DB_HOST || "NOT SET");
console.log("DATABASE NAME:", process.env.DB_NAME || "NOT SET");
console.log("DATABASE USER:", process.env.DB_USER || "NOT SET");
console.log("DATABASE PORT:", process.env.DB_PORT || "3306");
console.log("======================================");
console.log("");

/*
|--------------------------------------------------------------------------
| SECURITY
|--------------------------------------------------------------------------
*/

app.use(
  helmet({
    crossOriginResourcePolicy: {
      policy: "cross-origin",
    },

    // The frontend and API are on different Render domains.
    crossOriginOpenerPolicy: false,
  })
);

/*
|--------------------------------------------------------------------------
| REQUEST LOGGING
|--------------------------------------------------------------------------
*/

app.use(
  morgan((tokens, req, res) => {
    const responseTime = tokens["response-time"](req, res);

    return [
      tokens.method(req, res),
      tokens.url(req, res),
      tokens.status(req, res),
      `${responseTime} ms`,
      `Origin=${req.headers.origin || "none"}`,
    ].join(" ");
  })
);

/*
|--------------------------------------------------------------------------
| REQUEST TIMER
|--------------------------------------------------------------------------
|
| Helps identify requests that are taking too long.
|
*/

app.use((req, res, next) => {
  const started = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - started;

    if (duration > 5000) {
      console.warn(
        `[SLOW REQUEST] ${req.method} ${req.originalUrl} took ${duration} ms`
      );
    }
  });

  next();
});

/*
|--------------------------------------------------------------------------
| BODY PARSING
|--------------------------------------------------------------------------
*/

app.use(
  express.json({
    limit: "10mb",
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "10mb",
  })
);

/*
|--------------------------------------------------------------------------
| COOKIES
|--------------------------------------------------------------------------
*/

app.use(cookieParser());

/*
|--------------------------------------------------------------------------
| CORS
|--------------------------------------------------------------------------
*/

app.use(
  cors({
    origin(origin, callback) {
      /*
       * Allow requests without an Origin header.
       *
       * This is useful for:
       * - curl
       * - Render health checks
       * - server-to-server requests
       */
      if (!origin) {
        return callback(null, true);
      }

      const normalizedOrigin = origin.replace(/\/$/, "");

      if (uniqueOrigins.includes(normalizedOrigin)) {
        return callback(null, true);
      }

      console.warn("");
      console.warn("======================================");
      console.warn("CORS BLOCKED");
      console.warn("Origin:", origin);
      console.warn("Allowed:", uniqueOrigins);
      console.warn("======================================");

      return callback(
        new Error(`CORS blocked request from origin: ${origin}`)
      );
    },

    credentials: true,

    methods: [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS",
    ],

    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "Accept",
      "Origin",
    ],

    exposedHeaders: [
      "Content-Length",
      "Content-Type",
    ],

    optionsSuccessStatus: 204,
  })
);

/*
|--------------------------------------------------------------------------
| HEALTH CHECK
|--------------------------------------------------------------------------
|
| Both URLs are provided:
|
| /health
| /api/health
|
*/

const healthResponse = (req, res) => {
  res.status(200).json({
    success: true,
    ok: true,
    message: "HMS API is running",
    environment: process.env.NODE_ENV || "development",
    timestamp: new Date().toISOString(),
  });
};

app.get("/health", healthResponse);
app.get("/api/health", healthResponse);

/*
|--------------------------------------------------------------------------
| DATABASE HEALTH CHECK
|--------------------------------------------------------------------------
|
| This endpoint is extremely important for diagnosing the current
| login problem.
|
| Open:
|
| https://hms-server-odkt.onrender.com/api/db-test
|
*/

app.get("/api/db-test", async (req, res) => {
  const started = Date.now();

  console.log("");
  console.log("======================================");
  console.log("DATABASE TEST");
  console.log("======================================");
  console.log("Running: SELECT 1");

  try {
    const [rows] = await pool.execute(
      "SELECT 1 AS test"
    );

    const duration = Date.now() - started;

    console.log("DATABASE TEST SUCCESS");
    console.log("Result:", rows);
    console.log("Time:", `${duration} ms`);
    console.log("======================================");
    console.log("");

    return res.status(200).json({
      success: true,
      database: "connected",
      result: rows,
      durationMs: duration,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    const duration = Date.now() - started;

    console.error("");
    console.error("======================================");
    console.error("DATABASE TEST FAILED");
    console.error("======================================");
    console.error("Message:", error.message);
    console.error("Code:", error.code);
    console.error("Errno:", error.errno);
    console.error("SQL State:", error.sqlState);
    console.error("Time:", `${duration} ms`);
    console.error("======================================");
    console.error("");

    return res.status(500).json({
      success: false,
      database: "failed",
      message: error.message,
      code: error.code || null,
      errno: error.errno || null,
      sqlState: error.sqlState || null,
      durationMs: duration,
      timestamp: new Date().toISOString(),
    });
  }
});

/*
|--------------------------------------------------------------------------
| DATABASE INFORMATION
|--------------------------------------------------------------------------
|
| This is a diagnostic endpoint.
|
| It does NOT expose the database password.
|
*/

app.get("/api/db-info", async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT
        DATABASE() AS database_name,
        USER() AS database_user,
        VERSION() AS mysql_version,
        NOW() AS database_time
    `);

    return res.status(200).json({
      success: true,
      database: rows[0],
    });

  } catch (error) {
    console.error("[DB INFO ERROR]", error);

    return res.status(500).json({
      success: false,
      message: error.message,
      code: error.code || null,
    });
  }
});

/*
|--------------------------------------------------------------------------
| ROOT ROUTE
|--------------------------------------------------------------------------
*/

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "HMS API is running",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
  });
});

/*
|--------------------------------------------------------------------------
| AUTH ROUTES
|--------------------------------------------------------------------------
*/

app.use(
  "/api/auth",
  authRoutes
);

/*
|--------------------------------------------------------------------------
| PROTECTED ROUTES
|--------------------------------------------------------------------------
*/

app.use(
  "/api/admin",
  authMiddleware,
  adminRoutes
);

app.use(
  "/api/patients",
  authMiddleware,
  patientRoutes
);

app.use(
  "/api/visits",
  authMiddleware,
  visitRoutes
);

app.use(
  "/api/triage",
  authMiddleware,
  triageRoutes
);

app.use(
  "/api/doctor",
  authMiddleware,
  doctorRoutes
);

app.use(
  "/api/lab",
  authMiddleware,
  labRoutes
);

app.use(
  "/api/pharmacy",
  authMiddleware,
  pharmacyRoutes
);

app.use(
  "/api/inventory",
  authMiddleware,
  inventoryRoutes
);

app.use(
  "/api/finance",
  authMiddleware,
  financeRoutes
);

/*
|--------------------------------------------------------------------------
| 404 HANDLER
|--------------------------------------------------------------------------
*/

app.use((req, res) => {
  console.warn(
    `[404] ${req.method} ${req.originalUrl}`
  );

  return res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

/*
|--------------------------------------------------------------------------
| GLOBAL ERROR HANDLER
|--------------------------------------------------------------------------
*/

app.use((err, req, res, next) => {
  console.error("");
  console.error("======================================");
  console.error("GLOBAL SERVER ERROR");
  console.error("======================================");
  console.error("Method:", req.method);
  console.error("URL:", req.originalUrl);
  console.error("Origin:", req.headers.origin);
  console.error("Message:", err.message);
  console.error("Stack:", err.stack);
  console.error("======================================");
  console.error("");

  if (
    err.message &&
    err.message.startsWith("CORS blocked")
  ) {
    return res.status(403).json({
      success: false,
      message: err.message,
    });
  }

  return res.status(500).json({
    success: false,
    message: "Internal server error",
  });
});

/*
|--------------------------------------------------------------------------
| STARTUP DATABASE TEST
|--------------------------------------------------------------------------
|
| This checks the database when Render starts the server.
|
*/

async function testDatabaseConnection() {
  console.log("");
  console.log("======================================");
  console.log("DATABASE STARTUP TEST");
  console.log("======================================");

  const started = Date.now();

  try {
    const [rows] = await pool.execute(
      "SELECT 1 AS test"
    );

    const duration = Date.now() - started;

    console.log("✅ DATABASE CONNECTED");
    console.log("Result:", rows);
    console.log("Response time:", `${duration} ms`);
    console.log("======================================");
    console.log("");

    return true;

  } catch (error) {
    const duration = Date.now() - started;

    console.error("❌ DATABASE CONNECTION FAILED");
    console.error("Message:", error.message);
    console.error("Code:", error.code);
    console.error("Errno:", error.errno);
    console.error("SQL State:", error.sqlState);
    console.error("Time:", `${duration} ms`);
    console.error("======================================");
    console.error("");

    return false;
  }
}

/*
|--------------------------------------------------------------------------
| START SERVER
|--------------------------------------------------------------------------
*/

const server = app.listen(
  PORT,
  "0.0.0.0",
  async () => {
    console.log("");
    console.log("======================================");
    console.log("        HMS API STARTED");
    console.log("======================================");
    console.log(`Port: ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
    console.log(`Client: ${CLIENT_URL}`);
    console.log("Root: /");
    console.log("Health: /health");
    console.log("API Health: /api/health");
    console.log("DB Test: /api/db-test");
    console.log("DB Info: /api/db-info");
    console.log("======================================");
    console.log("");

    await testDatabaseConnection();
  }
);

/*
|--------------------------------------------------------------------------
| SERVER TIMEOUTS
|--------------------------------------------------------------------------
|
| Prevent connections from remaining open forever.
|
*/

server.requestTimeout = 60000;
server.headersTimeout = 65000;
server.keepAliveTimeout = 5000;

/*
|--------------------------------------------------------------------------
| GRACEFUL SHUTDOWN
|--------------------------------------------------------------------------
*/

async function shutdown(signal) {
  console.log("");
  console.log(`Received ${signal}. Shutting down HMS server...`);

  server.close(async () => {
    try {
      await pool.end();

      console.log("Database pool closed.");
      console.log("HMS server stopped.");

      process.exit(0);
    } catch (error) {
      console.error(
        "Error while closing database pool:",
        error
      );

      process.exit(1);
    }
  });

  setTimeout(() => {
    console.error(
      "Forced shutdown after timeout."
    );

    process.exit(1);
  }, 10000);
}

process.on(
  "SIGTERM",
  () => shutdown("SIGTERM")
);

process.on(
  "SIGINT",
  () => shutdown("SIGINT")
);

/*
|--------------------------------------------------------------------------
| UNHANDLED ERRORS
|--------------------------------------------------------------------------
*/

process.on(
  "unhandledRejection",
  (reason) => {
    console.error(
      "UNHANDLED PROMISE REJECTION:",
      reason
    );
  }
);

process.on(
  "uncaughtException",
  (error) => {
    console.error(
      "UNCAUGHT EXCEPTION:",
      error
    );
  }
);

export default app;
