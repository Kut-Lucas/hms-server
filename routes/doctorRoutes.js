import { Router } from 'express';
import * as d from '../controllers/doctorController.js';
import { requireRole } from '../middleware/role.js';

const r = Router();
r.use(requireRole('doctor', 'admin'));
r.get('/queue', d.doctorQueue);
r.get('/handled-today', d.doctorHandledToday);
r.get('/my-lab-order/:id', d.getMyLabOrder);
r.get('/my-prescription/:id', d.getMyPrescription);
r.post('/lab-order', d.createLabOrder);
r.post('/prescription', d.createPrescription);
r.get('/lab-results/:visitId', d.labResultsForVisit);
r.get('/drug-search', d.drugSearch);
r.get('/lab-tests', d.getLabTests);
r.get('/service-procedures', d.getServiceProcedures);

export default r;
