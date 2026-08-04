import { Router } from 'express';
import * as ph from '../controllers/pharmacyController.js';
import { requireRole } from '../middleware/role.js';

const r = Router();
r.get('/queue', requireRole('pharmacist', 'admin'), ph.pharmacyQueue);
r.get('/completed-today', requireRole('pharmacist', 'admin'), ph.pharmacyCompletedToday);
r.get('/my-sale/:id', requireRole('pharmacist', 'admin'), ph.getMyPharmacySale);
r.post('/dispense', requireRole('pharmacist', 'admin'), ph.dispense);
r.get('/inventory', requireRole('pharmacist', 'admin'), ph.pharmacyInventory);

export default r;
