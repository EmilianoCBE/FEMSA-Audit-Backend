// US15-US17 - Emiliano Carrizales: asistente de diseño del App Builder (Designer).
// Junta las reglas (US16, siempre disponibles) con las propuestas del proveedor de IA (US15), valida todo con el esquema
// y nunca modifica la configuración: solo devuelve propuestas que el usuario acepta o rechaza en el front (US17).
import { findDesignerLayout } from "../../models/designer.model.js";
import { notFoundError } from "../../utils/httpErrors.js";
import { hydrateDesignerLayout } from "../designer.service.js";
import { validateAppId } from "../versions.service.js";
import { getAiProvider } from "./providers/index.js";
import { runDesignerRules } from "./rules/designer.rules.js";
import { providerResponseSchema, suggestionSchema } from "./schemas.js";

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
function withoutFieldId({ fieldId: _ignored, ...rest }) {
  return rest;
}

export function validateAiSuggestions(raw, fields, ruleSuggestions = []) {
  const parsed = providerResponseSchema.safeParse(raw);
  if (!parsed.success) return [];

  const fieldIds = new Set(fields.map((field) => field.id));
  const covered = new Set(ruleSuggestions.map((suggestion) => `${suggestion.fieldId}:${suggestion.change?.op}`));

  return parsed.data.suggestions.flatMap((candidate) => {
    // Agregar un campo no apunta a uno existente: si el modelo pega un fieldId ahí, se ignora.
    const normalized = candidate?.change?.op === "add-field" ? withoutFieldId(candidate) : candidate;
    const result = suggestionSchema.safeParse(normalized);
    if (!result.success) return [];
    const suggestion = result.data;
    // Un campo o componente sugerido sin cambio concreto no se puede aceptar: se descarta.
    if (suggestion.kind !== "inconsistency" && !suggestion.change) return [];
    const targets = [suggestion.fieldId, suggestion.change?.fieldId].filter(Boolean);
    if (targets.some((id) => !fieldIds.has(id))) return [];
    if (suggestion.fieldId && covered.has(`${suggestion.fieldId}:${suggestion.change?.op}`)) return [];
    return [suggestion];
  });
}

export async function analyzeDesigner(
  appIdInput,
  { provider = getAiProvider(), timeoutMs = Number(process.env.AI_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS } = {},
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
    aiSuggestions = await withTimeout(async (signal) => {
      // Si una respuesta no deja ninguna sugerencia válida y queda tiempo, se pide una vez más.
      let valid = [];
      for (let attempt = 0; attempt < 2; attempt++) {
        const raw = await provider.suggestDesigner({ fields, known: ruleSuggestions }, { signal });
        valid = validateAiSuggestions(raw, fields, ruleSuggestions);
        if (valid.length > 0 || Date.now() - started > timeoutMs / 2) break;
      }
      return valid;
    }, timeoutMs);
  } catch {
    aiAvailable = false;
  }

  return {
    appId,
    aiAvailable,
    provider: provider.name,
    promptVersion: provider.promptVersion,
    latencyMs: Date.now() - started,
    suggestions: [
      ...ruleSuggestions.map((suggestion, index) => ({ id: `rules-${index + 1}`, source: "rules", ...suggestion })),
      ...aiSuggestions.map((suggestion, index) => ({ id: `ai-${index + 1}`, source: "ai", ...suggestion })),
    ],
  };
}
