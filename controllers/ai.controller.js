// US15-US17 - Emiliano Carrizales: asistente de diseño (solo HTTP; la lógica está en services/ai).
import {
  analyzeDesigner,
  decideRecommendation,
  getAiStatus,
  getAssistantMetrics,
  getDesignerMetrics,
} from "../services/ai/ai.service.js";
import { analyzeWorkflowAi, decideWorkflowRule, generateWorkflowAi } from "../services/ai/workflow.service.js";

export const postAnalyzeDesigner = async (req, res) =>
  res.json(await analyzeDesigner(req.body?.appId, { user: req.user }));

export const postRecommendationDecision = async (req, res) =>
  res.json({ recommendation: await decideRecommendation(req.params.id, req.body, req.user) });

export const getDesignerMetricsController = async (req, res) => res.json(await getDesignerMetrics(req.query.appId));

export const getAiStatusController = async (_req, res) => res.json(await getAiStatus());

export const postAnalyzeWorkflow = async (req, res) => res.json(await analyzeWorkflowAi(req.body, { user: req.user }));

export const postWorkflowRuleDecision = async (req, res) =>
  res.status(201).json({ recommendation: await decideWorkflowRule(req.body, req.user) });

export const getWorkflowMetricsController = async (req, res) =>
  res.json(await getAssistantMetrics(req.query.appId, "workflow"));

export const postGenerateWorkflow = async (req, res) => res.json(await generateWorkflowAi(req.body));
