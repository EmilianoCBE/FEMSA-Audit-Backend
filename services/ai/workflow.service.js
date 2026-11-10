// US15 (RF-17, RF-18) - Emiliano Carrizales: la IA sugiere transiciones y roles para el flujo del hallazgo.
// Las reglas del workflow (US16) corren en el front; aquí solo se agregan las propuestas de la IA, validadas.
// No se guarda nada: el workflow todavía no vive en la BD (US04), así que las decisiones quedan en pantalla.
import { badRequest } from "../../utils/httpErrors.js";
import { withTimeout } from "./ai.service.js";
import { aiStatus, recordFailure, recordSuccess } from "./availability.js";
import { getAiProvider } from "./providers/index.js";
import { providerResponseSchema, workflowInputSchema, workflowSuggestionSchema } from "./schemas.js";

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
  { provider = getAiProvider(), timeoutMs = Number(process.env.AI_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS } = {},
) {
  const parsed = workflowInputSchema.safeParse(input);
  if (!parsed.success) throw badRequest("El flujo enviado no es válido.");
  const workflow = parsed.data;

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

  return {
    aiAvailable,
    aiUnavailableReason,
    aiRetryAt,
    provider: provider.name,
    promptVersion: provider.workflowPromptVersion ?? null,
    latencyMs: Date.now() - started,
    suggestions: suggestions.map((suggestion, index) => ({
      id: `ai-workflow-${index + 1}`,
      source: "ai",
      ...suggestion,
    })),
  };
}
