import { Router } from "express";

import {
  getRisksWithControlsController,
  getRiskWithControlsController,
  getControlEvaluationHistoryController,
  createControlEvaluationController,
} from "../controllers/controlEvaluation.controller.js";

import {
  requireAuth,
  sameOrigin,
} from "../middlewares/auth.js";

const router = Router();

// Evitar que las respuestas de evaluaciones se almacenen en caché.
router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

// Todas las operaciones requieren una sesión autenticada.
router.use(requireAuth, sameOrigin);

// Listar riesgos y controles.
router.get("/risks", getRisksWithControlsController);

// Consultar un riesgo, sus controles y su riesgo residual.
router.get("/risk/:riskId", getRiskWithControlsController);

// Consultar el historial de un control.
router.get("/control/:controlId", getControlEvaluationHistoryController);

// Registrar una nueva evaluación.
router.post("/", createControlEvaluationController);

export default router;