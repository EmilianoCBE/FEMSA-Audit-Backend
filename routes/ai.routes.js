import { Router } from "express";
import {
  getAiStatusController,
  getDesignerMetricsController,
  postAnalyzeDesigner,
  postAnalyzeWorkflow,
  getWorkflowMetricsController,
  postGenerateWorkflow,
  postRecommendationDecision,
  postWorkflowRuleDecision,
} from "../controllers/ai.controller.js";
import { requireAuth, sameOrigin } from "../middlewares/auth.js";

const router = Router();

router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

/** US18: si la IA está disponible (comprobación ligera, sin generar texto), para avisar antes de analizar. */
router.get("/status", requireAuth, getAiStatusController);

/** US15-US17: analiza un formulario del Designer y devuelve propuestas; no cambia nada. */
router.post("/designer/analyze", requireAuth, sameOrigin, postAnalyzeDesigner);

/** US15 (RF-18): recibe la estructura del flujo y devuelve transiciones y roles sugeridos; con appId las registra. */
router.post("/workflow/analyze", requireAuth, sameOrigin, postAnalyzeWorkflow);

/** RF-17: propone un flujo completo a partir de una descripción; no guarda ni aplica nada. */
router.post("/workflow/generate", requireAuth, sameOrigin, postGenerateWorkflow);

/** Fase 3 (US17): registra aceptar / rechazar / reemplazar de una revisión de las reglas del flujo. */
router.post("/workflow/decisions", requireAuth, sameOrigin, postWorkflowRuleDecision);

/** Métricas del asistente del flujo de un formulario (?appId=). */
router.get("/workflow/metrics", requireAuth, getWorkflowMetricsController);

/** US17: registra aceptar / rechazar / reemplazar de una sugerencia. */
router.post("/recommendations/:id/decision", requireAuth, sameOrigin, postRecommendationDecision);

/** Métricas de aceptación y latencia del asistente para un formulario (?appId=). */
router.get("/designer/metrics", requireAuth, getDesignerMetricsController);

export default router;
