import { Router } from 'express';
import * as auth from '../controllers/authController.js';
import { authMiddleware } from '../middleware/auth.js';

const r = Router();
r.post('/register', auth.register);
r.post('/login', auth.login);
r.post('/refresh', auth.refresh);
r.post('/logout', authMiddleware, auth.logout);
r.get('/me', authMiddleware, auth.me);
r.post('/reset-password', auth.resetPasswordWithCode);

export default r;
