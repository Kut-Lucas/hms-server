import { Router } from 'express';
import * as l from '../controllers/labController.js';
import { requireRole } from '../middleware/role.js';

const r = Router();
r.use(requireRole('lab_technician', 'admin'));
r.get('/queue', l.labQueue);
r.get('/completed-today', l.labCompletedToday);
r.get('/my-result/:id', l.getMyLabResult);
r.patch('/orders/:id/start', l.startLabOrder);
r.post('/results', l.submitLabResults);
r.post('/dressing-charge', l.submitDressingCharge);
r.get('/results/:resultId/pdf', l.labResultReportPdf);

export default r;
