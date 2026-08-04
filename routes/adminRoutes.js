import { Router } from 'express';
import * as admin from '../controllers/adminController.js';
import { requireRole } from '../middleware/role.js';

const r = Router();
r.use(requireRole('admin'));
r.get('/stats', admin.adminStats);
r.get('/patients', admin.listAllPatients);
r.get('/visits/queue', admin.listQueueForDate);
r.get('/visits/attended', admin.listAttendedForDate);
r.get('/visits', admin.listVisitsByDate);
r.get('/users', admin.listUsers);
r.patch('/users/:id/approve', admin.approveUser);
r.patch('/users/:id/role', admin.changeRole);
r.patch('/users/:id/deactivate', admin.deactivateUser);
r.post('/users/:id/reset-code', admin.generateResetCode);
r.get('/audit-log', admin.auditLogList);

export default r;
