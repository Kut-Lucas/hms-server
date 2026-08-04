import { Router } from 'express';
import multer from 'multer';
import * as inv from '../controllers/inventoryController.js';
import { requireRole } from '../middleware/role.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const r = Router();
r.get('/low-stock', requireRole('admin', 'pharmacist'), inv.lowStock);
r.get('/usage-report', requireRole('admin'), inv.usageReport);
r.get('/prescribed-report', requireRole('admin'), inv.prescribedReport);
r.post('/bulk-import', requireRole('admin'), upload.single('file'), inv.bulkImportInventory);
r.get('/', requireRole('admin', 'pharmacist'), inv.listInventory);
r.post('/', requireRole('admin'), inv.addInventory);
r.patch('/:id', requireRole('admin'), inv.updateInventory);
r.post('/:id/restock', requireRole('admin', 'pharmacist'), inv.restock);

export default r;
