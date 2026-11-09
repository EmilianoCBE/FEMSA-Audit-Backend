import assert from "node:assert/strict";
import { test } from "node:test";
import { DESIGNER_CASES, ELEMENTS } from "../evals/designer.cases.js";
import { validateAiSuggestions } from "../services/ai/ai.service.js";
import { percentile, scoreCase, summarize } from "../services/ai/eval.js";
import { mockProvider } from "../services/ai/providers/mock.provider.js";
import { normalize, runDesignerRules } from "../services/ai/rules/designer.rules.js";
import { FIELD_TYPES, SECTIONS } from "../services/ai/schemas.js";

const present = (testCase, key) => testCase.fields.some((field) => ELEMENTS[key].pattern.test(normalize(field.label)));

test("US15 los casos de evaluación son coherentes", () => {
  assert.ok(DESIGNER_CASES.length >= 10, "PLAN-IA pide 10-20 casos");
  assert.equal(new Set(DESIGNER_CASES.map((c) => c.id)).size, DESIGNER_CASES.length);
  for (const testCase of DESIGNER_CASES) {
    assert.ok(testCase.description, testCase.id);
    assert.equal(new Set(testCase.fields.map((field) => field.id)).size, testCase.fields.length, testCase.id);
    for (const field of testCase.fields) {
      assert.ok(FIELD_TYPES.includes(field.type), `${testCase.id}/${field.id}`);
      assert.ok(SECTIONS.includes(field.section), `${testCase.id}/${field.id}`);
    }
    // Lo que se espera que falte de verdad no está en el formulario, y lo demás sí.
    for (const key of testCase.missing) {
      assert.ok(ELEMENTS[key], `${testCase.id}: elemento desconocido ${key}`);
      assert.equal(present(testCase, key), false, `${testCase.id}: ${key} sí está en el formulario`);
    }
    for (const { fieldId, type } of testCase.components) {
      const field = testCase.fields.find((candidate) => candidate.id === fieldId);
      assert.ok(field && field.type !== type, `${testCase.id}: ${fieldId}`);
    }
  }
  const complete = DESIGNER_CASES.find((c) => c.id === "completo");
  assert.ok(Object.keys(ELEMENTS).every((key) => present(complete, key)));
});

test("US15 califica faltantes encontrados, componentes, repetidos y explicaciones", () => {
  const testCase = {
    id: "prueba",
    fields: [
      { id: "titulo", type: "short-text", label: "Título", section: "identificacion" },
      { id: "plazo", type: "short-text", label: "Fecha compromiso", section: "remediacion" },
    ],
    missing: ["owner", "cause"],
    components: [{ fieldId: "plazo", type: "date" }],
  };
  const raw = {
    suggestions: [
      {
        kind: "field",
        title: "Agregar responsable",
        reason: "Alguien debe atender el plan.",
        confidence: "media",
        change: { op: "add-field", type: "short-text", label: "Responsable del plan", section: "remediacion" },
      },
      {
        kind: "component",
        title: "Usar fecha",
        reason: "Es una fecha.",
        confidence: "alta",
        fieldId: "plazo",
        change: { op: "change-field-type", fieldId: "plazo", type: "date" },
      },
      {
        kind: "field",
        title: "Agregar fecha compromiso",
        reason: "Ya existe, es ruido.",
        confidence: "baja",
        change: { op: "add-field", type: "date", label: "Fecha compromiso de atención" },
      },
      { kind: "field", title: "Sin explicación", confidence: "baja" },
    ],
  };
  const valid = validateAiSuggestions(raw, testCase.fields);
  const result = scoreCase(testCase, { raw, valid, latencyMs: 1200 });

  assert.equal(result.jsonValid, true);
  assert.equal(result.returned, 4);
  assert.equal(result.withReason, 3);
  assert.equal(result.valid, 3);
  assert.equal(result.missingFound, 1);
  assert.deepEqual(result.missingNotFound, ["cause"]);
  assert.equal(result.componentsFound, 1);
  assert.equal(result.componentsByAi, 1);
  assert.deepEqual(result.redundant, ["Fecha compromiso de atención"]);
});

test("US15 un componente que ya corrige la regla cuenta aunque la IA no lo repita", () => {
  const testCase = DESIGNER_CASES.find((c) => c.id === "fecha-como-texto");
  const rules = runDesignerRules(testCase.fields);
  const result = scoreCase(testCase, { raw: { suggestions: [] }, valid: [], rules, latencyMs: 800 });
  assert.equal(result.componentsFound, 1);
  assert.equal(result.componentsByAi, 0);
});

test("US15 una respuesta inválida o una falla cuentan en el resumen", () => {
  const testCase = DESIGNER_CASES[1];
  const invalid = scoreCase(testCase, { raw: { nada: true }, valid: [], latencyMs: 900 });
  assert.equal(invalid.jsonValid, false);
  assert.equal(invalid.returned, 0);

  const failed = scoreCase(testCase, { error: new Error("timeout"), latencyMs: 15000 });
  assert.deepEqual(failed, { id: testCase.id, ok: false, error: "timeout", latencyMs: 15000 });

  const summary = summarize([invalid, failed]);
  assert.equal(summary.failed, 1);
  assert.equal(summary.jsonValidRate, 0);
  assert.equal(summary.latency.maxMs, 15000);
  assert.equal(summary.latency.underGoalRate, 0.5);
});

test("US15 el conjunto completo corre con el proveedor simulado (sin llamar a Gemini)", async () => {
  const results = [];
  for (const testCase of DESIGNER_CASES) {
    const known = runDesignerRules(testCase.fields);
    const raw = await mockProvider.suggestDesigner({ fields: testCase.fields, known });
    const valid = validateAiSuggestions(raw, testCase.fields, known);
    results.push(scoreCase(testCase, { raw, valid, rules: known, latencyMs: 5 }));
  }
  const summary = summarize(results);
  assert.equal(summary.cases, DESIGNER_CASES.length);
  assert.equal(summary.failed, 0);
  assert.equal(summary.jsonValidRate, 1);
  assert.equal(summary.reasonRate, 1);
  // El simulado solo propone fecha y responsable: encuentra algunos faltantes, no todos.
  assert.ok(summary.missingRecall > 0 && summary.missingRecall < 1);
  assert.equal(summary.redundant, 0);
  assert.equal(summary.componentRecall, 1, "las reglas corrigen los componentes de los casos");
});

test("US15 percentil por rango más cercano", () => {
  assert.equal(percentile([], 95), null);
  assert.equal(percentile([5, 1, 3], 50), 3);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 95), 12);
});
