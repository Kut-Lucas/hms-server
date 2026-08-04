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
const PORT = process.env.PORT || 5000;
const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
const allowedOrigins = [
  ...new Set([
    clientUrl,
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://192.168.0.105:5173',
  ]),
].filter(Boolean);

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(morgan('dev'));
app.use(cookieParser());
app.use(express.json());
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: true,
  })
);

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/admin', authMiddleware, adminRoutes);
app.use('/api/patients', authMiddleware, patientRoutes);
app.use('/api/visits', authMiddleware, visitRoutes);
app.use('/api/triage', authMiddleware, triageRoutes);
app.use('/api/doctor', authMiddleware, doctorRoutes);
app.use('/api/lab', authMiddleware, labRoutes);
app.use('/api/pharmacy', authMiddleware, pharmacyRoutes);
app.use('/api/inventory', authMiddleware, inventoryRoutes);
app.use('/api/finance', authMiddleware, financeRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`HMS API listening on http://localhost:${PORT} (and http://192.168.0.105:${PORT} on your LAN)`);
});
