// US15-US17 - Emiliano Carrizales: asistente de diseño (solo HTTP; la lógica está en services/ai).
import { analyzeDesigner } from "../services/ai/ai.service.js";

export const postAnalyzeDesigner = async (req, res) => res.json(await analyzeDesigner(req.body?.appId));
