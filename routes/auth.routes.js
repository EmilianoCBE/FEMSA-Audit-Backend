import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { login, logout, me } from '../controllers/auth.controller.js';
import { entraStart, entraCallback } from '../controllers/entra.controller.js';
import { requireAuth, sameOrigin } from '../middlewares/auth.js';

const router = Router();
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
const limit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { msg: 'Demasiados intentos. Intenta de nuevo en 15 minutos.' } });
router.post('/login', sameOrigin, limit, login);
router.post('/logout', sameOrigin, logout);
router.get('/me', requireAuth, me);
router.get('/entra', limit, entraStart);
router.get('/entra/callback', entraCallback);
export default router;
