
import { Router } from 'express';

import {
  createRiskEvaluationController,
  getRiskEvaluationsController,
  getRiskEvaluationSummaryController,
  compareRiskEvaluationsController,
  getRiskEvaluationsByRiskIdController,
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

router.use(requireAuth, sameOrigin);

// Seguimiento: historial de un riesgo específico.
router.get(
  '/risk/:riskLibraryId',
  getRiskEvaluationsByRiskIdController
);

// Comparación: evaluaciones disponibles de un riesgo.
router.get(
  '/compare/:riskLibraryId',
  compareRiskEvaluationsController
);

// Resumen: estadísticas generales con filtros opcionales.
router.get(
  '/summary',
  getRiskEvaluationSummaryController
);

// Historial general con filtros y paginación.
router.get('/', getRiskEvaluationsController);

// Guardar una nueva evaluación.
router.post('/', createRiskEvaluationController);

export default router;


