
import { Router } from 'express';

import {
  createRiskEvaluationController,
} from '../controllers/riskEvaluation.controller.js';

import {
  requireAuth,
  sameOrigin,
} from '../middlewares/auth.js';

const router = Router();

router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

router.post(
  '/',
  requireAuth,
  sameOrigin,
  createRiskEvaluationController
);

export default router;
