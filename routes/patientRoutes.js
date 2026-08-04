import { Router } from 'express';
import * as p from '../controllers/patientController.js';
import { requireRole } from '../middleware/role.js';

const r = Router();
r.post('/', requireRole('receptionist', 'admin'), p.createPatient);
r.get('/today', requireRole('receptionist', 'admin'), p.listRegisteredToday);
r.get('/search', p.searchPatients);
r.get('/:id/vitals', requireRole('doctor', 'triage', 'admin'), p.getPatientVitals);
r.get('/:id', p.getPatient);

export default r;
