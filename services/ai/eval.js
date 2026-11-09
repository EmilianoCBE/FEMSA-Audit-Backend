// US15 - Emiliano Carrizales: calificación del conjunto de evaluación (PLAN-IA §7). Funciones puras, sin llamadas a
// la IA: `scripts/ai-eval.js` las usa con Gemini y `tests/ai.eval.test.js` las prueba con respuestas fijas.
import { ELEMENTS } from "../../evals/designer.cases.js";
import { normalize } from "./rules/designer.rules.js";
import { providerResponseSchema, suggestionSchema } from "./schemas.js";

export const LATENCY_GOAL_MS = 10_000;

const matches = (key, label) => ELEMENTS[key].pattern.test(normalize(label));
const hasReason = (item) => typeof item?.reason === "string" && item.reason.trim().length > 0;

/**
 * Califica un caso.
 * @param testCase caso de evals/designer.cases.js
 * @param run { raw, valid, rules, latencyMs, error } — `raw` es la respuesta del modelo, `valid` lo que sobrevivió a la
 *   validación y `rules` lo que ya detectaron las reglas (US16). Los componentes cuentan lo que ve el usuario (reglas +
 *   IA), porque a la IA se le pide no repetir lo que ya señalan las reglas; los faltantes solo los propone la IA.
 */
export function scoreCase(testCase, { raw, valid = [], rules = [], latencyMs, error } = {}) {
  if (error) {
    return { id: testCase.id, ok: false, error: String(error.message ?? error), latencyMs };
  }
  const items = providerResponseSchema.safeParse(raw).success ? raw.suggestions : [];
  const adds = valid.filter((suggestion) => suggestion.change?.op === "add-field");
  const present = Object.keys(ELEMENTS).filter((key) => testCase.fields.some((field) => matches(key, field.label)));

  const missingFound = testCase.missing.filter((key) =>
    adds.some((suggestion) => matches(key, suggestion.change.label)),
  );
  const proposesType = (list, { fieldId, type }) =>
    list.some(
      (suggestion) =>
        suggestion.change?.op === "change-field-type" &&
        suggestion.change.fieldId === fieldId &&
        suggestion.change.type === type,
    );
  const componentsFound = testCase.components.filter((expected) => proposesType([...rules, ...valid], expected));
  const componentsByAi = testCase.components.filter((expected) => proposesType(valid, expected));
  // Proponer agregar algo que el formulario ya tiene: ruido para el usuario.
  const redundant = adds.filter((suggestion) => present.some((key) => matches(key, suggestion.change.label)));

  return {
    id: testCase.id,
    ok: true,
    latencyMs,
    jsonValid: providerResponseSchema.safeParse(raw).success,
    returned: items.length,
    wellFormed: items.filter((item) => suggestionSchema.safeParse(item).success).length,
    withReason: items.filter(hasReason).length,
    valid: valid.length,
    missingExpected: testCase.missing.length,
    missingFound: missingFound.length,
    missingNotFound: testCase.missing.filter((key) => !missingFound.includes(key)),
    componentsExpected: testCase.components.length,
    componentsFound: componentsFound.length,
    componentsByAi: componentsByAi.length,
    redundant: redundant.map((suggestion) => suggestion.change.label),
  };
}

const sum = (results, key) => results.reduce((total, result) => total + (result[key] ?? 0), 0);
const ratio = (part, total) => (total === 0 ? null : part / total);

/** Percentil por rango más cercano (p95 de 12 casos = el 12.º más lento). */
export function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

export function summarize(results) {
  const ok = results.filter((result) => result.ok);
  const latencies = results.map((result) => result.latencyMs).filter((value) => Number.isFinite(value));
  return {
    cases: results.length,
    failed: results.length - ok.length,
    jsonValidRate: ratio(ok.filter((result) => result.jsonValid).length, results.length),
    reasonRate: ratio(sum(ok, "withReason"), sum(ok, "returned")),
    discardRate: ratio(sum(ok, "returned") - sum(ok, "valid"), sum(ok, "returned")),
    suggestions: sum(ok, "valid"),
    missingRecall: ratio(sum(ok, "missingFound"), sum(ok, "missingExpected")),
    componentRecall: ratio(sum(ok, "componentsFound"), sum(ok, "componentsExpected")),
    componentsByAi: sum(ok, "componentsByAi"),
    redundant: ok.reduce((total, result) => total + result.redundant.length, 0),
    latency: {
      avgMs: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null,
      p95Ms: percentile(latencies, 95),
      maxMs: latencies.length ? Math.max(...latencies) : null,
      underGoalRate: ratio(latencies.filter((value) => value < LATENCY_GOAL_MS).length, latencies.length),
    },
  };
}
