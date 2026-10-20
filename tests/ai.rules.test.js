import assert from "node:assert/strict";
import { test } from "node:test";
import { toDesignerFields, validateAiSuggestions } from "../services/ai/ai.service.js";
import { mockProvider } from "../services/ai/providers/mock.provider.js";
import {
  calculatedWithoutFormulaRule,
  componentHintRule,
  duplicateLabelRule,
  genericLabelRule,
  runDesignerRules,
} from "../services/ai/rules/designer.rules.js";

const field = (id, type, label, extra = {}) => ({
  id,
  type,
  label,
  required: false,
  section: null,
  formula: null,
  ...extra,
});

test("US16 detecta etiquetas vacías o que siguen con el nombre del componente", () => {
  const result = genericLabelRule([
    field("a", "short-text", "Texto corto"),
    field("b", "catalog", "Lista de opciones"),
    field("c", "short-text", "  "),
    field("d", "short-text", "Título del hallazgo"),
    field("e", "section", "Adjunto"),
  ]);
  assert.deepEqual(
    result.map((s) => s.fieldId),
    ["a", "b", "c"],
  );
  assert.ok(result.every((s) => s.kind === "inconsistency" && s.reason.length > 20));
});

test("US16 detecta etiquetas duplicadas sin importar mayúsculas ni acentos", () => {
  const result = duplicateLabelRule([
    field("a", "short-text", "Descripción"),
    field("b", "long-text", "descripcion"),
    field("c", "short-text", "Otro"),
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].fieldId, "b");
  assert.match(result[0].reason, /\ba\b/);
});

test("US16 detecta campos calculados sin fórmula", () => {
  const result = calculatedWithoutFormulaRule([
    field("a", "calculated", "Riesgo residual"),
    field("b", "calculated", "Puntaje", { formula: "probabilidad * impacto" }),
  ]);
  assert.deepEqual(
    result.map((s) => s.fieldId),
    ["a"],
  );
});

test("US15 recomienda el componente adecuado según la etiqueta (RF-19)", () => {
  const result = componentHintRule([
    field("a", "short-text", "Fecha de vencimiento"),
    field("b", "short-text", "Monto observado"),
    field("c", "short-text", "Observaciones del auditor"),
    field("d", "date", "Fecha de cierre"),
    field("e", "long-text", "Descripción"),
  ]);
  assert.deepEqual(
    result.map((s) => s.change),
    [
      { op: "change-field-type", fieldId: "a", type: "date" },
      { op: "change-field-type", fieldId: "b", type: "number" },
      { op: "change-field-type", fieldId: "c", type: "long-text" },
    ],
  );
});

test("US16 con la configuración vigente real (v6) encuentra las inconsistencias esperadas", () => {
  const v6 = toDesignerFields([
    { id: "titulo", type: "short-text", config: { label: "Titulo del hallazgo", required: true } },
    { id: "descripcion", type: "long-text", config: { label: "Descripcion", required: true } },
    { id: "t1", type: "short-text", config: { label: "Texto corto" } },
    { id: "t2", type: "short-text", config: { label: "Texto corto" } },
    { id: "n1", type: "number", config: { label: "Numerico" } },
    { id: "l1", type: "catalog", config: { label: "Lista de opciones" } },
    { id: "c1", type: "calculated", config: { label: "Campo calculado" } },
    { id: "s1", type: "section", config: { label: "Adjunto" } },
  ]);
  const result = runDesignerRules(v6);
  const byField = (id) => result.filter((s) => s.fieldId === id).length;
  assert.equal(byField("titulo"), 0);
  assert.equal(byField("t2"), 2); // genérica y duplicada
  assert.equal(byField("c1"), 2); // genérica y sin fórmula
  assert.ok(result.every((s) => s.reason));
});

test("US17 la respuesta de la IA se valida: se descarta lo inventado o mal formado", () => {
  const fields = [field("a", "short-text", "Fecha límite")];
  const rules = componentHintRule(fields);
  const valid = { kind: "field", title: "Agregar responsable", reason: "Para dar seguimiento.", confidence: "media" };
  const result = validateAiSuggestions(
    {
      suggestions: [
        valid,
        { ...valid, reason: "" }, // sin explicación (RNF-12)
        { ...valid, change: { op: "delete-everything" } }, // operación no permitida
        { ...valid, fieldId: "no-existe" }, // campo inventado
        { ...valid, change: { op: "rename-field", fieldId: "fantasma", label: "x" } },
        { ...valid, fieldId: "a", change: { op: "change-field-type", fieldId: "a", type: "date" } }, // repite una regla
        "texto suelto",
      ],
    },
    fields,
    rules,
  );
  assert.deepEqual(result, [valid]);
  assert.deepEqual(validateAiSuggestions("no es json", fields), []);
  assert.deepEqual(validateAiSuggestions({ suggestions: "x" }, fields), []);
});

test("el proveedor simulado responde con el mismo formato que exige el esquema", async () => {
  const fields = [field("a", "short-text", "Titulo")];
  const raw = await mockProvider.suggestDesigner({ fields });
  assert.equal(validateAiSuggestions(raw, fields).length, raw.suggestions.length);
  assert.ok(raw.suggestions.length > 0);
});
