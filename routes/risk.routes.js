
import { Router } from 'express';

import { classifyRiskController } from '../controllers/risk.controller.js';

import {
  requireAuth,
  sameOrigin,
} from '../middlewares/auth.js';

const router = Router();

router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

/**
 * US07.1 - US07.4
 *
 * Clasifica un riesgo a partir de probabilidad e impacto.
 */
router.post(
  '/classify',
  requireAuth,
  sameOrigin,
  classifyRiskController
);

export default router;
