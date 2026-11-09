import { Router } from "express";
import {
  getAiStatusController,
  getDesignerMetricsController,
  postAnalyzeDesigner,
  postRecommendationDecision,
} from "../controllers/ai.controller.js";
import { requireAuth, sameOrigin } from "../middlewares/auth.js";

const router = Router();

router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

/** US18: si la IA está disponible (sin llamarla), para avisar antes de analizar. */
router.get("/status", requireAuth, getAiStatusController);

/** US15-US17: analiza un formulario del Designer y devuelve propuestas; no cambia nada. */
router.post("/designer/analyze", requireAuth, sameOrigin, postAnalyzeDesigner);

/** US17: registra aceptar / rechazar / reemplazar de una sugerencia. */
router.post("/recommendations/:id/decision", requireAuth, sameOrigin, postRecommendationDecision);

/** Métricas de aceptación y latencia del asistente para un formulario (?appId=). */
router.get("/designer/metrics", requireAuth, getDesignerMetricsController);

export default router;
