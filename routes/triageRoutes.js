import { Router } from 'express';
import * as t from '../controllers/triageController.js';
import { requireRole } from '../middleware/role.js';

const r = Router();
r.use(requireRole('triage', 'admin'));
r.get('/queue', t.triageQueue);
r.get('/completed-today', t.triageCompletedToday);
r.get('/record/vitals/:id', t.getVitalsRecord);
r.post('/vitals', t.submitVitals);

export default r;
