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

import './loadEnv.js';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';

import { authMiddleware } from './middleware/auth.js';

import authRoutes from './routes/authRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import patientRoutes from './routes/patientRoutes.js';
import visitRoutes from './routes/visitRoutes.js';
import triageRoutes from './routes/triageRoutes.js';
import doctorRoutes from './routes/doctorRoutes.js';
import labRoutes from './routes/labRoutes.js';
import pharmacyRoutes from './routes/pharmacyRoutes.js';
import inventoryRoutes from './routes/inventoryRoutes.js';
import financeRoutes from './routes/financeRoutes.js';

const app = express();

// Render provides PORT through environment variables
const PORT = process.env.PORT || 5000;

// Frontend URL from Render environment variables
const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';

// Allowed frontend origins
const allowedOrigins = [
  clientUrl,
  'https://hms-client-f8lm.onrender.com',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://192.168.0.105:5173',
].filter(Boolean);

// Remove duplicate origins
const uniqueOrigins = [...new Set(allowedOrigins)];

console.log('Allowed CORS origins:', uniqueOrigins);

// -----------------------------------------------------
// SECURITY / MIDDLEWARE
// -----------------------------------------------------

app.use(
  helmet({
    crossOriginResourcePolicy: {
      policy: 'cross-origin',
    },
  })
);

app.use(morgan('dev'));

app.use(cookieParser());

app.use(
  express.json({
    limit: '10mb',
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: '10mb',
  })
);

// -----------------------------------------------------
// CORS
// -----------------------------------------------------

app.use(
  cors({
    origin(origin, callback) {
      // Allow requests without an Origin header
      // such as Postman, curl, server-to-server requests, etc.
      if (!origin) {
        return callback(null, true);
      }

      if (uniqueOrigins.includes(origin)) {
        return callback(null, true);
      }

      console.warn(`Blocked CORS origin: ${origin}`);

      return callback(
        new Error(`CORS blocked request from origin: ${origin}`)
      );
    },

    credentials: true,

    methods: [
      'GET',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'OPTIONS',
    ],

    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'Accept',
      'Origin',
    ],
  })
);

// -----------------------------------------------------
// ROOT / SERVER STATUS
// -----------------------------------------------------

app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'HMS API is running',
    status: 'online',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
  });
});

// -----------------------------------------------------
// HEALTH CHECK
// -----------------------------------------------------

app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    ok: true,
    message: 'HMS API is healthy',
    timestamp: new Date().toISOString(),
  });
});

// -----------------------------------------------------
// API ROUTES
// -----------------------------------------------------

// Authentication routes do NOT require authMiddleware
app.use('/api/auth', authRoutes);

// Protected routes
app.use('/api/admin', authMiddleware, adminRoutes);

app.use('/api/patients', authMiddleware, patientRoutes);

app.use('/api/visits', authMiddleware, visitRoutes);

app.use('/api/triage', authMiddleware, triageRoutes);

app.use('/api/doctor', authMiddleware, doctorRoutes);

app.use('/api/lab', authMiddleware, labRoutes);

app.use('/api/pharmacy', authMiddleware, pharmacyRoutes);

app.use('/api/inventory', authMiddleware, inventoryRoutes);

app.use('/api/finance', authMiddleware, financeRoutes);

// -----------------------------------------------------
// 404 HANDLER
// -----------------------------------------------------

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
    path: req.originalUrl,
    method: req.method,
  });
});

// -----------------------------------------------------
// GLOBAL ERROR HANDLER
// -----------------------------------------------------

app.use((err, req, res, next) => {
  console.error('SERVER ERROR:', err);

  // CORS error
  if (err.message?.startsWith('CORS blocked')) {
    return res.status(403).json({
      success: false,
      message: err.message,
    });
  }

  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error',
  });
});

// -----------------------------------------------------
// START SERVER
// -----------------------------------------------------

app.listen(PORT, '0.0.0.0', () => {
  console.log('======================================');
  console.log('        HMS API SERVER STARTED        ');
  console.log('======================================');
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Port: ${PORT}`);
  console.log(`Local: http://localhost:${PORT}`);
  console.log(`Health: http://localhost:${PORT}/api/health`);

  if (process.env.RENDER_EXTERNAL_URL) {
    console.log(`Render URL: ${process.env.RENDER_EXTERNAL_URL}`);
  }

  console.log('======================================');
});
