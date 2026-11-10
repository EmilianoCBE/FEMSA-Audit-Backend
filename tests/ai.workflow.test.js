import assert from "node:assert/strict";
import { test } from "node:test";
import { buildWorkflowPrompt } from "../services/ai/prompts/workflow.v1.js";
import { createGeminiProvider } from "../services/ai/providers/gemini.provider.js";
import { getAiProvider } from "../services/ai/providers/index.js";
import { mockProvider } from "../services/ai/providers/mock.provider.js";
import { analyzeWorkflowAi, validateWorkflowSuggestions } from "../services/ai/workflow.service.js";

// Flujo de ejemplo (igual al del front): la validación del responsable no puede regresar a revisión.
const workflow = {
  states: [
    { id: "draft", name: "Borrador", kind: "Inicial" },
    { id: "in-review", name: "En revisión", kind: "En proceso" },
    { id: "manager", name: "Validación del responsable", kind: "Aprobación" },
    { id: "director", name: "Validación dirección", kind: "Aprobación" },
    { id: "closed", name: "Cerrado", kind: "Final" },
    { id: "rejected", name: "Rechazado", kind: "Retorno" },
  ],
  transitions: [
    { id: "send", from: "draft", to: "in-review", label: "enviar", role: "Auditor" },
    { id: "review", from: "in-review", to: "manager", label: "revisar", role: "Auditor" },
    { id: "approve", from: "manager", to: "director", label: "aprobar", role: "Jefe de Auditoría" },
    { id: "close", from: "director", to: "closed", label: "cerrar", role: null },
    { id: "reject", from: "director", to: "rejected", label: "rechazar", role: "Dirección de Auditoría" },
    { id: "back", from: "rejected", to: "in-review", label: "devolver a revisión", role: null },
  ],
  known: [{ title: "«cerrar» no tiene rol asignado", change: { op: "set-transition-role", transitionId: "close" } }],
};

const suggestion = (change, extra = {}) => ({
  kind: change.op === "add-transition" ? "relation" : "role",
  title: "Sugerencia",
  reason: "Mejora el control del hallazgo.",
  confidence: "media",
  change,
  ...extra,
});

test("US15 RF-18 valida las sugerencias del flujo y descarta lo inventado o repetido", () => {
  const add = (from, to) => ({ op: "add-transition", from, to, label: "devolver", role: "Jefe de Auditoría" });
  const raw = {
    suggestions: [
      suggestion(add("manager", "in-review")), // válida
      suggestion(add("manager", "no-existe")), // estado inventado
      suggestion(add("in-review", "manager")), // ya existe
      suggestion(add("closed", "in-review")), // sale de un estado final
      suggestion(add("manager", "manager")), // a sí mismo
      suggestion(add("manager", "in-review")), // repetida en la misma respuesta
      suggestion({ op: "set-transition-role", transitionId: "close", role: "Dirección de Auditoría" }), // ya la dicen las reglas
      suggestion({ op: "set-transition-role", transitionId: "approve", role: "Jefe de Auditoría" }), // ya tiene ese rol
      suggestion({ op: "set-transition-role", transitionId: "back", role: "Gerente" }), // rol no permitido
      { kind: "relation", title: "Sin cambio", reason: "No se puede aplicar.", confidence: "baja" },
      {
        kind: "inconsistency",
        title: "Falta aceptación de riesgo",
        reason: "Observación de negocio.",
        confidence: "baja",
        target: { type: "state", id: "fantasma" },
      },
      {
        kind: "inconsistency",
        title: "Revisar segregación",
        reason: "Observación de negocio.",
        confidence: "baja",
        target: { type: "state", id: "manager" },
      },
    ],
  };
  const valid = validateWorkflowSuggestions(raw, workflow);
  assert.deepEqual(
    valid.map((item) => item.change ?? item.title),
    [add("manager", "in-review"), "Revisar segregación"],
  );
  assert.deepEqual(validateWorkflowSuggestions({ nada: true }, workflow), []);
});

test("US15 RF-17 el asistente sugiere relaciones que faltan, cada una explicada (simulado)", async () => {
  const result = await analyzeWorkflowAi(workflow, { provider: mockProvider });
  assert.equal(result.aiAvailable, true);
  assert.equal(result.aiUnavailableReason, null);
  assert.equal(result.suggestions.length, 1);
  const [first] = result.suggestions;
  assert.equal(first.source, "ai");
  assert.equal(first.id, "ai-workflow-1");
  assert.deepEqual(first.change, {
    op: "add-transition",
    from: "manager",
    to: "in-review",
    label: "devolver",
    role: "Jefe de Auditoría",
  });
  assert.ok(first.reason.length > 20);
});

test("US15 valida el flujo recibido", async () => {
  await assert.rejects(analyzeWorkflowAi({ states: [], transitions: [] }, { provider: mockProvider }), { status: 400 });
  await assert.rejects(analyzeWorkflowAi({ nada: 1 }, { provider: mockProvider }), { status: 400 });
});

test("US18 si la IA del flujo falla o no está configurada, responde sin sugerencias y dice por qué", async () => {
  const broken = { name: "roto", suggestWorkflow: async () => Promise.reject(new Error("503")) };
  const failed = await analyzeWorkflowAi(workflow, { provider: broken, timeoutMs: 50 });
  assert.equal(failed.aiAvailable, false);
  assert.equal(failed.aiUnavailableReason, "error");
  assert.deepEqual(failed.suggestions, []);

  const slow = { name: "lento", suggestWorkflow: () => new Promise(() => {}) };
  assert.equal((await analyzeWorkflowAi(workflow, { provider: slow, timeoutMs: 30 })).aiUnavailableReason, "timeout");

  const missing = getAiProvider({ AI_PROVIDER: "gemini" });
  const notConfigured = await analyzeWorkflowAi(workflow, { provider: missing });
  assert.equal(notConfigured.aiUnavailableReason, "not-configured");
});

test("RNF-13 al modelo solo va la estructura del flujo", () => {
  const prompt = JSON.parse(
    buildWorkflowPrompt({
      ...workflow,
      states: workflow.states.map((state) => ({ ...state, position: { x: 1, y: 2 }, owner: "persona@femsa.com" })),
    }),
  );
  assert.deepEqual(Object.keys(prompt), ["states", "transitions", "known"]);
  assert.deepEqual(Object.keys(prompt.states[0]), ["id", "name", "kind"]);
  assert.deepEqual(Object.keys(prompt.transitions[0]), ["id", "from", "to", "label", "role"]);
  assert.ok(!JSON.stringify(prompt).includes("persona@femsa.com"));
});

test("US15 Gemini usa el prompt y el esquema del flujo", async () => {
  const requests = [];
  const client = {
    models: {
      async generateContent(request) {
        requests.push(request);
        return { text: JSON.stringify({ suggestions: [] }) };
      },
    },
  };
  const provider = createGeminiProvider({ client });
  assert.deepEqual(await provider.suggestWorkflow(workflow), { suggestions: [] });
  assert.equal(provider.workflowPromptVersion, "workflow-v1");
  assert.match(requests[0].config.systemInstruction, /ciclo de vida de un hallazgo/);
  assert.deepEqual(
    requests[0].config.responseJsonSchema.properties.suggestions.items.properties.change.properties.op.enum,
    ["add-transition", "set-transition-role"],
  );
});
