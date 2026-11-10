// US15 (RF-17, RF-18) - Emiliano Carrizales: la IA sugiere transiciones y roles para el flujo del hallazgo.
// Las reglas del workflow (US16) corren en el front; aquí se agregan las propuestas de la IA, validadas.
// Fase 3: si llega el formulario (appId), las sugerencias y las decisiones se registran en dbo.AppAiRecommendations
// (scope 'workflow') para medir el asistente, y la IA puede proponer un flujo completo desde una descripción (RF-17).
import { randomUUID } from "node:crypto";
import { aiRecommendationsRepository } from "../../repositories/aiRecommendations.repository.js";
import { badRequest, HttpError } from "../../utils/httpErrors.js";
import { validateAppId } from "../versions.service.js";
import { isMissingTable, MISSING_TABLE_MESSAGE, toPublicSuggestion, withTimeout } from "./ai.service.js";
import { aiStatus, recordFailure, recordSuccess } from "./availability.js";
import { getAiProvider } from "./providers/index.js";
import {
  generatedWorkflowSchema,
  generateWorkflowInputSchema,
  providerResponseSchema,
  workflowInputSchema,
  workflowRuleDecisionSchema,
  workflowSuggestionSchema,
} from "./schemas.js";

const DEFAULT_TIMEOUT_MS = 8000;

const changeKey = (change) =>
  change?.op === "add-transition"
    ? `add:${change.from}->${change.to}`
    : change?.op === "set-transition-role"
      ? `role:${change.transitionId}`
      : null;

/** Descarta lo que la IA inventó o repite: ids que no existen, transiciones que ya están, lo que ya dicen las reglas. */
export function validateWorkflowSuggestions(raw, { states, transitions, known = [] }) {
  const parsed = providerResponseSchema.safeParse(raw);
  if (!parsed.success) return [];

  const stateById = new Map(states.map((state) => [state.id, state]));
  const transitionById = new Map(transitions.map((transition) => [transition.id, transition]));
  const existing = new Set(transitions.map((transition) => `add:${transition.from}->${transition.to}`));
  const covered = new Set(known.map((item) => changeKey(item.change)).filter(Boolean));
  const seen = new Set();

  return parsed.data.suggestions.flatMap((candidate) => {
    const result = workflowSuggestionSchema.safeParse(candidate);
    if (!result.success) return [];
    const suggestion = result.data;
    const { change, target } = suggestion;
    if (suggestion.kind !== "inconsistency" && !change) return [];
    if (target && !(target.type === "state" ? stateById : transitionById).has(target.id)) return [];

    if (change?.op === "add-transition") {
      const from = stateById.get(change.from);
      if (!from || !stateById.has(change.to) || change.from === change.to || from.kind === "Final") return [];
    }
    if (change?.op === "set-transition-role") {
      const transition = transitionById.get(change.transitionId);
      if (!transition || transition.role === change.role) return [];
    }
    const key = changeKey(change);
    if (key && (existing.has(key) || covered.has(key) || seen.has(key))) return [];
    if (key) seen.add(key);
    return [suggestion];
  });
}

export async function analyzeWorkflowAi(
  input,
  { provider = getAiProvider(), timeoutMs = Number(process.env.AI_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS, user } = {},
) {
  const parsed = workflowInputSchema.safeParse(input);
  if (!parsed.success) throw badRequest("El flujo enviado no es válido.");
  const { appId: appIdInput, ...workflow } = parsed.data;
  const appId = appIdInput ? validateAppId(appIdInput) : null;

  const started = Date.now();
  const status = aiStatus(provider);
  let aiAvailable = status.aiAvailable;
  let aiUnavailableReason = status.reason;
  let aiRetryAt = status.retryAt;
  let suggestions = [];

  if (aiAvailable) {
    try {
      suggestions = await withTimeout(async (signal) => {
        // Como en el Designer: si una respuesta no deja ninguna sugerencia válida y queda tiempo, se pide una vez más.
        let valid = [];
        for (let attempt = 0; attempt < 2; attempt++) {
          valid = validateWorkflowSuggestions(await provider.suggestWorkflow(workflow, { signal }), workflow);
          if (valid.length > 0 || Date.now() - started > timeoutMs / 2) break;
        }
        return valid;
      }, timeoutMs);
      recordSuccess(provider);
    } catch (error) {
      aiAvailable = false;
      aiUnavailableReason = error?.code === "AI_TIMEOUT" ? "timeout" : "error";
      recordFailure(provider, aiUnavailableReason);
      aiRetryAt = aiStatus(provider).retryAt;
    }
  }

  const latencyMs = Date.now() - started;
  const promptVersion = provider.workflowPromptVersion ?? null;
  let shown = suggestions.map((suggestion, index) => ({ id: `ai-workflow-${index + 1}`, source: "ai", ...suggestion }));

  // Fase 3 (US17): con el formulario, cada sugerencia mostrada se guarda para registrar después la decisión.
  // Si la BD falla o falta la migración, el asistente sigue respondiendo (recorded: false) con ids temporales.
  let recorded = false;
  if (appId && shown.length > 0) {
    try {
      const saved = await aiRecommendationsRepository.createMany({
        appId,
        analysisId: randomUUID(),
        suggestions: shown,
        provider: provider.name,
        promptVersion,
        latencyMs,
        requestedBy: user?.id,
        scope: "workflow",
      });
      if (saved.length === shown.length) {
        shown = saved.map(toPublicSuggestion);
        recorded = true;
      }
    } catch (error) {
      console.warn(
        `[ai] No se guardaron las sugerencias del flujo: ${isMissingTable(error) ? MISSING_TABLE_MESSAGE : error.message}`,
      );
    }
  }

  return {
    aiAvailable,
    aiUnavailableReason,
    aiRetryAt,
    recorded,
    provider: provider.name,
    promptVersion,
    latencyMs,
    suggestions: shown,
  };
}

/**
 * Fase 3 (US17): registra la decisión sobre una revisión de las reglas del flujo. Las reglas corren en el navegador,
 * así que la sugerencia llega completa y se guarda ya decidida (las de la IA se deciden con /recommendations/:id).
 */
export async function decideWorkflowRule(body, user) {
  const parsed = workflowRuleDecisionSchema.safeParse(body);
  if (!parsed.success) throw badRequest("La decisión enviada no es válida.");
  const { suggestion, decision, change } = parsed.data;
  const appId = validateAppId(parsed.data.appId);

  if (decision !== "rejected" && !suggestion.change) {
    throw badRequest("Esta revisión no trae un cambio que se pueda aplicar; solo se puede rechazar.");
  }
  if (decision === "replaced" && !change) {
    throw badRequest("Para reemplazar se requiere el cambio que aplicó el usuario (change).");
  }

  try {
    const saved = await aiRecommendationsRepository.createDecided({
      appId,
      suggestion: {
        kind: "inconsistency",
        title: suggestion.title,
        reason: suggestion.reason,
        confidence: "alta",
        target: suggestion.target ?? null,
        change: suggestion.change ?? null,
      },
      status: decision,
      appliedChange: decision === "replaced" ? change : null,
      decidedBy: user?.id,
      provider: "rules",
      promptVersion: `workflow-rules:${suggestion.rule}`,
    });
    return { ...toPublicSuggestion(saved), status: saved.status, appliedChange: saved.appliedChange };
  } catch (error) {
    if (isMissingTable(error)) throw new HttpError(503, MISSING_TABLE_MESSAGE);
    throw error;
  }
}

/* ---------- RF-17: generar un flujo desde una descripción ---------- */

const REDACTED = "[dato omitido]";

/**
 * Privacidad (RNF-13): la descripción es texto libre, así que antes de enviarla se quitan correos y números largos
 * (teléfonos, cuentas, nóminas). El front además pide no escribir nombres ni datos confidenciales.
 */
export function redactDescription(description) {
  const text = description.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, REDACTED).replace(/\+?\d[\d\s().-]{5,}\d/g, REDACTED);
  return { text, redacted: text !== description };
}

/**
 * Revisa que el flujo propuesto se pueda usar: ids únicos, un solo estado inicial, al menos un final, transiciones
 * entre estados que existen, sin salir de un final, todos los estados alcanzables y ninguno atorado.
 * Regresa el flujo con ids de transición o `null` si no sirve.
 */
export function validateGeneratedWorkflow(raw) {
  const parsed = generatedWorkflowSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { summary, states, transitions } = parsed.data;

  const byId = new Map(states.map((state) => [state.id, state]));
  if (byId.size !== states.length) return null;
  const initials = states.filter((state) => state.kind === "Inicial");
  if (initials.length !== 1 || !states.some((state) => state.kind === "Final")) return null;

  const seen = new Set();
  const clean = [];
  for (const transition of transitions) {
    const from = byId.get(transition.from);
    const key = `${transition.from}->${transition.to}`;
    if (!from || !byId.has(transition.to) || transition.from === transition.to || from.kind === "Final") return null;
    if (seen.has(key)) continue;
    seen.add(key);
    // El número al inicio lo hace único aunque se recorte (los ids del flujo guardado miden hasta 60).
    clean.push({ id: `t${clean.length + 1}-${transition.from}-${transition.to}`.slice(0, 60), ...transition });
  }

  const reached = new Set([initials[0].id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const transition of clean) {
      if (reached.has(transition.from) && !reached.has(transition.to)) {
        reached.add(transition.to);
        grew = true;
      }
    }
  }
  if (reached.size !== states.length) return null;
  const stuck = states.some(
    (state) => state.kind !== "Final" && !clean.some((transition) => transition.from === state.id),
  );
  if (stuck) return null;

  return { summary, states, transitions: clean };
}

const GENERATE_TIMEOUT_MS = 15000;

/**
 * RF-17: la IA propone un flujo completo a partir de una descripción. No se guarda ni se aplica nada: el front lo
 * muestra como vista previa y el usuario decide si lo usa (después puede editarlo y guardarlo).
 */
export async function generateWorkflowAi(
  input,
  { provider = getAiProvider(), timeoutMs = Number(process.env.AI_GENERATE_TIMEOUT_MS) || GENERATE_TIMEOUT_MS } = {},
) {
  const parsed = generateWorkflowInputSchema.safeParse(input);
  if (!parsed.success) throw badRequest("Describe el proceso en 15 a 1000 caracteres.");
  const { text: description, redacted } = redactDescription(parsed.data.description);

  const started = Date.now();
  const status = aiStatus(provider);
  let aiAvailable = status.aiAvailable;
  let aiUnavailableReason = status.reason;
  let aiRetryAt = status.retryAt;
  let workflow = null;

  if (aiAvailable) {
    try {
      workflow = await withTimeout(async (signal) => {
        // Si la propuesta no se puede usar y queda tiempo, se pide una vez más.
        let valid = null;
        for (let attempt = 0; attempt < 2 && !valid; attempt++) {
          valid = validateGeneratedWorkflow(await provider.generateWorkflow({ description }, { signal }));
          if (Date.now() - started > timeoutMs / 2) break;
        }
        return valid;
      }, timeoutMs);
      recordSuccess(provider);
    } catch (error) {
      aiAvailable = false;
      aiUnavailableReason = error?.code === "AI_TIMEOUT" ? "timeout" : "error";
      recordFailure(provider, aiUnavailableReason);
      aiRetryAt = aiStatus(provider).retryAt;
    }
  }

  return {
    aiAvailable,
    aiUnavailableReason,
    aiRetryAt,
    redacted,
    provider: provider.name,
    promptVersion: provider.generatePromptVersion ?? null,
    latencyMs: Date.now() - started,
    workflow,
  };
}
