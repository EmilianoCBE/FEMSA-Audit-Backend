// US15-US17 - Emiliano Carrizales: asistente de diseño del App Builder (Designer).
// Junta las reglas (US16, siempre disponibles) con las propuestas del proveedor de IA (US15), valida todo con el esquema
// y nunca modifica la configuración: solo devuelve propuestas que el usuario acepta o rechaza en el front (US17).
import { randomUUID } from "node:crypto";
import { findDesignerLayout } from "../../models/designer.model.js";
import { aiRecommendationsRepository } from "../../repositories/aiRecommendations.repository.js";
import { badRequest, HttpError, notFoundError } from "../../utils/httpErrors.js";
import { hydrateDesignerLayout } from "../designer.service.js";
import { validateAppId } from "../versions.service.js";
import { getAiProvider } from "./providers/index.js";
import { runDesignerRules } from "./rules/designer.rules.js";
import { changeSchema, providerResponseSchema, suggestionSchema } from "./schemas.js";

const DEFAULT_TIMEOUT_MS = 8000;

/** Solo la estructura del formulario: es lo único que sale hacia el proveedor de IA (RNF-13). */
export function toDesignerFields(elements = []) {
  return elements.map((element) => ({
    id: String(element.id),
    type: element.type,
    label: typeof element.config?.label === "string" ? element.config.label : "",
    required: element.config?.required === true,
    section: element.config?.section ?? null,
    formula: typeof element.config?.formula === "string" ? element.config.formula : null,
  }));
}

/** Corre la llamada al proveedor con límite de tiempo; al vencer, también cancela la petición (AbortSignal). */
function withTimeout(run, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`La IA no respondió en ${timeoutMs} ms.`));
    }, timeoutMs);
  });
  return Promise.race([run(controller.signal), timeout]).finally(() => clearTimeout(timer));
}

/**
 * Descarta lo que la IA inventó: formato inválido, campos que no existen o sugerencias que repiten una regla.
 * La IA solo propone, así que una respuesta mala se ignora en lugar de romper la pantalla.
 */
export function validateAiSuggestions(raw, fields, ruleSuggestions = []) {
  const parsed = providerResponseSchema.safeParse(raw);
  if (!parsed.success) return [];

  const fieldIds = new Set(fields.map((field) => field.id));
  const covered = new Set(ruleSuggestions.map((suggestion) => `${suggestion.fieldId}:${suggestion.change?.op}`));

  return parsed.data.suggestions.flatMap((candidate) => {
    const result = suggestionSchema.safeParse(candidate);
    if (!result.success) return [];
    const suggestion = result.data;
    const targets = [suggestion.fieldId, suggestion.change?.fieldId].filter(Boolean);
    if (targets.some((id) => !fieldIds.has(id))) return [];
    if (suggestion.fieldId && covered.has(`${suggestion.fieldId}:${suggestion.change?.op}`)) return [];
    return [suggestion];
  });
}

export async function analyzeDesigner(
  appIdInput,
  { provider = getAiProvider(), timeoutMs = Number(process.env.AI_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS, user } = {},
) {
  const appId = validateAppId(appIdInput);
  await hydrateDesignerLayout(appId);
  const layout = findDesignerLayout(appId);
  if (!layout) throw notFoundError("No existe ese formulario en el Designer.");

  const fields = toDesignerFields(layout.elements);
  const ruleSuggestions = runDesignerRules(fields);

  const started = Date.now();
  let aiSuggestions = [];
  let aiAvailable = true;
  try {
    const raw = await withTimeout(
      (signal) => provider.suggestDesigner({ fields, known: ruleSuggestions }, { signal }),
      timeoutMs,
    );
    aiSuggestions = validateAiSuggestions(raw, fields, ruleSuggestions);
  } catch {
    aiAvailable = false;
  }

  const latencyMs = Date.now() - started;
  const suggestions = [
    ...ruleSuggestions.map((suggestion, index) => ({ id: `rules-${index + 1}`, source: "rules", ...suggestion })),
    ...aiSuggestions.map((suggestion, index) => ({ id: `ai-${index + 1}`, source: "ai", ...suggestion })),
  ];

  // US17: cada sugerencia mostrada se guarda para registrar después la decisión del usuario.
  // Si la BD falla, el asistente sigue respondiendo (recorded: false) con ids temporales.
  let recorded = false;
  let shown = suggestions;
  try {
    const saved = await aiRecommendationsRepository.createMany({
      appId,
      analysisId: randomUUID(),
      suggestions,
      provider: provider.name,
      promptVersion: provider.promptVersion,
      latencyMs,
      requestedBy: user?.id,
    });
    if (saved.length === suggestions.length) {
      shown = saved.map(toPublicSuggestion);
      recorded = true;
    }
  } catch {
    recorded = false;
  }

  return {
    appId,
    aiAvailable,
    recorded,
    provider: provider.name,
    promptVersion: provider.promptVersion,
    latencyMs,
    suggestions: shown,
  };
}

function toPublicSuggestion(recommendation) {
  const { id, source, kind, title, reason, confidence, fieldId, change } = recommendation;
  return { id, source, kind, title, reason, confidence, ...(fieldId && { fieldId }), ...(change && { change }) };
}

const DECISIONS = ["accepted", "rejected", "replaced"];

/** US17: registra que el usuario aceptó, rechazó o reemplazó una sugerencia. Cada sugerencia se decide una sola vez. */
export async function decideRecommendation(idInput, body, user) {
  const id = Number(idInput);
  if (!Number.isInteger(id) || id <= 0) throw notFoundError("No existe esa sugerencia.");

  const decision = body?.decision;
  if (!DECISIONS.includes(decision)) throw badRequest(`decision debe ser ${DECISIONS.join(", ")}.`);

  let appliedChange = null;
  if (decision === "replaced") {
    const parsed = changeSchema.safeParse(body?.change);
    if (!parsed.success) throw badRequest("Para reemplazar se requiere el cambio que aplicó el usuario (change).");
    appliedChange = parsed.data;
  }

  const existing = await aiRecommendationsRepository.findById(id);
  if (!existing) throw notFoundError("No existe esa sugerencia.");
  if (decision !== "rejected" && !existing.change) {
    throw badRequest("Esta sugerencia no trae un cambio que se pueda aplicar; solo se puede rechazar.");
  }

  const updated = await aiRecommendationsRepository.decide(id, {
    status: decision,
    appliedChange,
    decidedBy: user?.id,
  });
  if (!updated) throw new HttpError(409, "Esta sugerencia ya se había decidido.");
  return { ...toPublicSuggestion(updated), status: updated.status, appliedChange: updated.appliedChange };
}

const emptyCounts = () => ({ total: 0, pending: 0, accepted: 0, rejected: 0, replaced: 0 });

/** Métricas del asistente para un formulario: aceptación por origen (reglas / IA) y latencia promedio de la IA. */
export async function getDesignerMetrics(appIdInput) {
  const appId = validateAppId(appIdInput);
  const rows = await aiRecommendationsRepository.metrics(appId);
  const bySource = { rules: emptyCounts(), ai: emptyCounts() };
  let aiLatency = null;

  for (const row of rows) {
    const counts = bySource[row.source];
    if (!counts) continue;
    counts[row.status] += row.total;
    counts.total += row.total;
    if (row.source === "ai" && row.avgLatencyMs != null) aiLatency = Math.round(row.avgLatencyMs);
  }

  const acceptanceRate = (counts) => {
    const decided = counts.accepted + counts.rejected + counts.replaced;
    return decided ? Math.round(((counts.accepted + counts.replaced) / decided) * 100) / 100 : null;
  };

  return {
    appId,
    bySource,
    acceptanceRate: { rules: acceptanceRate(bySource.rules), ai: acceptanceRate(bySource.ai) },
    avgAiLatencyMs: aiLatency,
  };
}
