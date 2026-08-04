import { Router } from 'express';
import * as f from '../controllers/financeController.js';
import { requireRole } from '../middleware/role.js';

const r = Router();
r.get('/report', requireRole('admin'), f.financialReport);
r.get('/report/pdf', requireRole('admin'), f.financialReportPdf);
r.get('/patient/:id', requireRole('admin', 'receptionist'), f.patientPayments);
r.get('/payments', requireRole('admin'), f.listPayments);
r.get('/receipts/:receiptId/pdf', f.receiptPdf);
r.get(
  '/visits/:visitId/consolidated-receipt/pdf',
  requireRole('admin', 'receptionist', 'doctor', 'pharmacist', 'lab_technician', 'triage'),
  f.visitConsolidatedReceiptPdf
);
r.get(
  '/prescriptions/:prescriptionId/pharmacy-receipt/pdf',
  requireRole('pharmacist', 'admin'),
  f.pharmacyReceiptPdf
);

export default r;
