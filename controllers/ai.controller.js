// US15-US17 - Emiliano Carrizales: asistente de diseño (solo HTTP; la lógica está en services/ai).
import { analyzeDesigner, decideRecommendation, getDesignerMetrics } from "../services/ai/ai.service.js";

export const postAnalyzeDesigner = async (req, res) =>
  res.json(await analyzeDesigner(req.body?.appId, { user: req.user }));

export const postRecommendationDecision = async (req, res) =>
  res.json({ recommendation: await decideRecommendation(req.params.id, req.body, req.user) });

export const getDesignerMetricsController = async (req, res) => res.json(await getDesignerMetrics(req.query.appId));
