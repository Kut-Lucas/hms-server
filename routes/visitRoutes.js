import { Router } from 'express';
import * as v from '../controllers/visitController.js';
import { requireRole } from '../middleware/role.js';

const r = Router();
r.post('/', requireRole('receptionist', 'admin'), v.createVisit);
r.get('/active', v.listActiveVisits);
r.get('/today-completed', v.listTodayCompletedVisits);
r.get('/:id', v.getVisit);
r.patch('/:id/status', requireRole('admin'), v.patchVisitStatus);

export default r;
