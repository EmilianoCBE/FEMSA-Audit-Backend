import assert from "node:assert/strict";
import { after, before, beforeEach, mock, test } from "node:test";
import sql from "mssql";
import { aiRecommendationsRepository } from "../repositories/aiRecommendations.repository.js";
import { versionsRepository } from "../repositories/versions.repository.js";
import { buildGeneratePrompt } from "../services/ai/prompts/workflow-generate.v1.js";
import { createGeminiProvider } from "../services/ai/providers/gemini.provider.js";
import { getAiProvider } from "../services/ai/providers/index.js";
import { mockProvider } from "../services/ai/providers/mock.provider.js";
import { generateWorkflowAi, redactDescription, validateGeneratedWorkflow } from "../services/ai/workflow.service.js";
import { parseWorkflow } from "../services/workflow.schema.js";
import { SESSION_COOKIE, tokenHash } from "../utils/session.js";

// Fase 3 del workflow: registro de sugerencias y decisiones del asistente del flujo, métricas y RF-17.
// La BD solo se simula para la sesión; el repositorio de recomendaciones se reemplaza por uno en memoria.
const token = "e".repeat(64);
const sessionUser = {
  Id: "00000000-0000-4000-8000-000000000033",
  Name: "Emiliano Prueba",
  Role: "Administrador",
  RoleId: 2,
};
const headers = { Cookie: `${SESSION_COOKIE}=${token}`, "Content-Type": "application/json" };

let server;
let api;
let originalConnect;
let rows;

const workflow = {
  appId: "formulario-flujo",
  states: [
    { id: "draft", name: "Borrador", kind: "Inicial" },
    { id: "in-review", name: "En revisión", kind: "En proceso" },
    { id: "manager", name: "Validación del responsable", kind: "Aprobación" },
    { id: "closed", name: "Cerrado", kind: "Final" },
  ],
  transitions: [
    { id: "send", from: "draft", to: "in-review", label: "enviar", role: "Auditor" },
    { id: "review", from: "in-review", to: "manager", label: "revisar", role: "Auditor" },
    { id: "close", from: "manager", to: "closed", label: "cerrar", role: "Jefe de Auditoría" },
  ],
  known: [],
};

function useInMemoryRepository() {
  rows = [];
  const save = (row) => {
    const saved = { ...structuredClone(row), id: String(rows.length + 1) };
    rows.push(saved);
    return structuredClone(saved);
  };
  mock.method(aiRecommendationsRepository, "createMany", async ({ appId, suggestions, scope, ...rest }) =>
    suggestions.map((suggestion) =>
      save({ ...suggestion, appId, scope, status: "pending", appliedChange: null, ...rest }),
    ),
  );
  mock.method(aiRecommendationsRepository, "createDecided", async ({ appId, suggestion, status, ...rest }) =>
    save({ ...suggestion, appId, scope: "workflow", source: "rules", status, ...rest }),
  );
  mock.method(aiRecommendationsRepository, "findById", async (id) =>
    structuredClone(rows.find((row) => row.id === String(id)) ?? null),
  );
  mock.method(aiRecommendationsRepository, "decide", async (id, { status, appliedChange }) => {
    const row = rows.find((candidate) => candidate.id === String(id) && candidate.status === "pending");
    if (!row) return null;
    Object.assign(row, { status, appliedChange });
    return structuredClone(row);
  });
  mock.method(aiRecommendationsRepository, "metrics", async (appId, scope) => {
    const groups = new Map();
    for (const row of rows.filter((candidate) => candidate.appId === appId && candidate.scope === scope)) {
      const key = `${row.source}:${row.status}`;
      const group = groups.get(key) ?? { source: row.source, status: row.status, total: 0, avgLatencyMs: 900 };
      group.total += 1;
      groups.set(key, group);
    }
    return [...groups.values()];
  });
}

before(async () => {
  Object.assign(process.env, {
    DB_SERVER: "test",
    DB_NAME: "test",
    DB_USER: "test",
    DB_PASSWORD: "test",
    WEB_ORIGIN: "http://127.0.0.1:5173",
    AI_PROVIDER: "mock",
  });
  originalConnect = sql.ConnectionPool.prototype.connect;
  sql.ConnectionPool.prototype.connect = async () => ({
    close: async () => {},
    request() {
      const values = {};
      return {
        input(name, _type, value) {
          values[name] = value;
          return this;
        },
        async query(query) {
          if (query.includes("FROM dbo.AuthSessions")) {
            return { recordset: values.hash === tokenHash(token) ? [sessionUser] : [] };
          }
          throw new Error("Unexpected SQL");
        },
      };
    },
  });

  const { default: app } = await import("../app.js");
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  api = `http://127.0.0.1:${server.address().port}/api`;
});

beforeEach(() => {
  mock.restoreAll();
  mock.method(versionsRepository, "list", async () => []);
  useInMemoryRepository();
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  sql.ConnectionPool.prototype.connect = originalConnect;
  mock.restoreAll();
  const { closeDB } = await import("../db/db.js");
  await closeDB();
});

const post = (path, body, extra = {}) =>
  fetch(`${api}${path}`, { method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify(body) });

test("fase 3: con el formulario, las sugerencias de la IA del flujo se registran y regresan con su id", async () => {
  const result = await (await post("/ai/workflow/analyze", workflow)).json();
  assert.equal(result.recorded, true);
  assert.ok(result.suggestions.length > 0);
  assert.deepEqual(
    result.suggestions.map((suggestion) => suggestion.id),
    rows.map((row) => row.id),
  );
  assert.ok(rows.every((row) => row.scope === "workflow" && row.appId === "formulario-flujo"));
  assert.equal(rows[0].requestedBy, sessionUser.Id);
  // El destino de la sugerencia se guarda para marcarla en el diagrama.
  assert.deepEqual(result.suggestions[0].target, { type: "state", id: "manager" });

  // Sin formulario se comporta como antes: ids temporales y nada guardado.
  const { appId: _appId, ...withoutApp } = workflow;
  const loose = await (await post("/ai/workflow/analyze", withoutApp)).json();
  assert.equal(loose.recorded, false);
  assert.match(loose.suggestions[0].id, /^ai-workflow-\d+$/);
});

test("fase 3: si no se puede guardar, el asistente del flujo responde igual con recorded false", async () => {
  mock.method(aiRecommendationsRepository, "createMany", async () => {
    throw Object.assign(new Error("Invalid column name 'Scope'."), { number: 207 });
  });
  const warn = mock.method(console, "warn", () => {});
  const result = await (await post("/ai/workflow/analyze", workflow)).json();
  assert.equal(result.recorded, false);
  assert.ok(result.suggestions.length > 0);
  assert.match(warn.mock.calls[0].arguments[0], /npm run ai:migrate/);
});

test("fase 3: una sugerencia de la IA del flujo se reemplaza con las operaciones del flujo", async () => {
  const { suggestions } = await (await post("/ai/workflow/analyze", workflow)).json();
  const id = suggestions[0].id;
  const designerChange = { op: "set-required", fieldId: "f1", required: true };
  assert.equal(
    (await post(`/ai/recommendations/${id}/decision`, { decision: "replaced", change: designerChange })).status,
    400,
  );

  const change = { op: "add-transition", from: "manager", to: "draft", label: "devolver", role: "Jefe de Auditoría" };
  const response = await post(`/ai/recommendations/${id}/decision`, { decision: "replaced", change });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).recommendation.appliedChange, change);
});

test("fase 3: las decisiones sobre las reglas del flujo se guardan ya decididas", async () => {
  const suggestion = {
    rule: "transition-without-role",
    title: "«cerrar» no tiene rol asignado",
    reason: "Nadie podría ejecutarla.",
    target: { type: "transition", id: "close" },
    change: { op: "set-transition-role", transitionId: "close", role: "Dirección de Auditoría" },
  };
  const accepted = await post("/ai/workflow/decisions", {
    appId: "formulario-flujo",
    suggestion,
    decision: "accepted",
  });
  assert.equal(accepted.status, 201);
  assert.equal((await accepted.json()).recommendation.status, "accepted");

  const replacement = { op: "set-transition-role", transitionId: "close", role: "Jefe de Auditoría" };
  const replaced = await post("/ai/workflow/decisions", {
    appId: "formulario-flujo",
    suggestion,
    decision: "replaced",
    change: replacement,
  });
  assert.deepEqual((await replaced.json()).recommendation.appliedChange, replacement);

  const info = { rule: "missing-final-state", title: "Sin estado final", reason: "Nunca terminaría." };
  const rejected = await post("/ai/workflow/decisions", {
    appId: "formulario-flujo",
    suggestion: info,
    decision: "rejected",
  });
  assert.equal(rejected.status, 201);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].promptVersion, "workflow-rules:transition-without-role");
  assert.equal(rows[0].decidedBy, sessionUser.Id);

  // Una revisión sin cambio solo se puede rechazar; reemplazar exige el cambio; lo demás se valida.
  for (const body of [
    { appId: "formulario-flujo", suggestion: info, decision: "accepted" },
    { appId: "formulario-flujo", suggestion, decision: "replaced" },
    { appId: "formulario-flujo", suggestion, decision: "tal vez" },
    { appId: "formulario-flujo", suggestion: { ...suggestion, change: { op: "borrar-todo" } }, decision: "accepted" },
  ]) {
    assert.equal((await post("/ai/workflow/decisions", body)).status, 400, JSON.stringify(body));
  }
});

test("fase 3: decisiones del flujo piden sesión y mismo origen", async () => {
  const body = { appId: "x", suggestion: { rule: "r", title: "t", reason: "r" }, decision: "rejected" };
  const anonymous = await fetch(`${api}/ai/workflow/decisions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  assert.equal(anonymous.status, 401);
  assert.equal((await post("/ai/workflow/decisions", body, { Origin: "https://otro.example" })).status, 403);
  assert.equal(
    (await post("/ai/workflow/generate", { description: "x".repeat(20) }, { Origin: "https://otro.example" })).status,
    403,
  );
});

test("fase 3: métricas del asistente del flujo separadas de las del Designer", async () => {
  const { suggestions } = await (await post("/ai/workflow/analyze", workflow)).json();
  await post(`/ai/recommendations/${suggestions[0].id}/decision`, { decision: "accepted" });
  await post("/ai/workflow/decisions", {
    appId: "formulario-flujo",
    suggestion: { rule: "missing-final-state", title: "Sin estado final", reason: "Nunca terminaría." },
    decision: "rejected",
  });

  const metrics = await (await fetch(`${api}/ai/workflow/metrics?appId=formulario-flujo`, { headers })).json();
  assert.equal(metrics.bySource.ai.accepted, 1);
  assert.equal(metrics.bySource.rules.rejected, 1);
  assert.deepEqual(metrics.acceptanceRate, { rules: 0, ai: 1 });

  const designer = await (await fetch(`${api}/ai/designer/metrics?appId=formulario-flujo`, { headers })).json();
  assert.equal(designer.bySource.ai.total + designer.bySource.rules.total, 0);
});

test("fase 3: si falta la migración 006, métricas y decisiones del flujo responden 503 con la instrucción", async () => {
  const missing = async () => {
    throw Object.assign(new Error("Invalid column name 'Scope' (falta la migración 006)."), { number: 50206 });
  };
  mock.method(aiRecommendationsRepository, "metrics", missing);
  mock.method(aiRecommendationsRepository, "createDecided", missing);
  const metrics = await fetch(`${api}/ai/workflow/metrics?appId=formulario-flujo`, { headers });
  assert.equal(metrics.status, 503);
  assert.match((await metrics.json()).msg, /npm run ai:migrate/);
  const decision = await post("/ai/workflow/decisions", {
    appId: "formulario-flujo",
    suggestion: { rule: "r", title: "t", reason: "r" },
    decision: "rejected",
  });
  assert.equal(decision.status, 503);
});

/* ---------- RF-17 ---------- */

test("RF-17 genera un flujo desde una descripción y quita correos y teléfonos antes de enviarla", async () => {
  const response = await post("/ai/workflow/generate", {
    description:
      "El área responde con un plan de acción y damos seguimiento. Dudas a ana.perez@femsa.com o 81 1234 5678.",
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.aiAvailable, true);
  assert.equal(result.redacted, true);
  assert.equal(result.provider, "mock");
  assert.ok(result.workflow.states.some((state) => state.id === "remediacion"));
  assert.ok(result.workflow.transitions.every((transition) => transition.id.length <= 60));
  // Lo que regresa se puede guardar tal cual como flujo (el front solo agrega posiciones).
  assert.equal(result.workflow.states.filter((state) => state.kind === "Inicial").length, 1);

  assert.equal((await post("/ai/workflow/generate", { description: "corto" })).status, 400);
});

test("RF-17 lo que llega al proveedor ya viene sin datos personales", async () => {
  let received;
  const provider = {
    ...mockProvider,
    async generateWorkflow(input, options) {
      received = input.description;
      return mockProvider.generateWorkflow(input, options);
    },
  };
  await generateWorkflowAi(
    { description: "Escribir a juan@empresa.com.mx o al +52 (81) 8328-4000 para revisar." },
    { provider },
  );
  assert.equal(received, "Escribir a [dato omitido] o al [dato omitido] para revisar.");
  assert.deepEqual(redactDescription("Revisión anual 2026 del área de compras"), {
    text: "Revisión anual 2026 del área de compras",
    redacted: false,
  });
});

test("RF-17 sin IA responde que no está disponible y no inventa un flujo (US18)", async () => {
  const result = await generateWorkflowAi(
    { description: "Hallazgo que revisa el jefe y se cierra." },
    { provider: getAiProvider({ AI_PROVIDER: "gemini" }) },
  );
  assert.equal(result.aiAvailable, false);
  assert.equal(result.aiUnavailableReason, "not-configured");
  assert.equal(result.workflow, null);

  let calls = 0;
  const broken = {
    ...mockProvider,
    name: "roto",
    async generateWorkflow() {
      calls += 1;
      return { summary: "x", states: [], transitions: [] };
    },
  };
  const invalid = await generateWorkflowAi(
    { description: "Hallazgo que revisa el jefe y se cierra." },
    { provider: broken },
  );
  assert.equal(invalid.aiAvailable, true);
  assert.equal(invalid.workflow, null);
  assert.equal(calls, 2, "una propuesta inservible se vuelve a pedir una vez");
});

test("RF-17 se descartan flujos que no se podrían usar", () => {
  const base = {
    summary: "Flujo de prueba.",
    states: [
      { id: "a", name: "Borrador", kind: "Inicial" },
      { id: "b", name: "Revisión", kind: "Aprobación" },
      { id: "c", name: "Cerrado", kind: "Final" },
    ],
    transitions: [
      { from: "a", to: "b", label: "enviar", role: "Auditor" },
      { from: "b", to: "c", label: "cerrar", role: "Jefe de Auditoría" },
    ],
  };
  assert.ok(validateGeneratedWorkflow(base));
  const variants = {
    "dos iniciales": { ...base, states: base.states.map((s) => (s.id === "b" ? { ...s, kind: "Inicial" } : s)) },
    "sin final": { ...base, states: base.states.map((s) => (s.id === "c" ? { ...s, kind: "En proceso" } : s)) },
    "estado inventado": {
      ...base,
      transitions: [...base.transitions, { from: "b", to: "z", label: "x", role: "Auditor" }],
    },
    "sale de un final": {
      ...base,
      transitions: [...base.transitions, { from: "c", to: "a", label: "x", role: "Auditor" }],
    },
    inalcanzable: { ...base, states: [...base.states, { id: "d", name: "Suelto", kind: "Final" }] },
    atorado: {
      ...base,
      states: [...base.states, { id: "d", name: "Atorado", kind: "En proceso" }],
      transitions: [...base.transitions, { from: "b", to: "d", label: "x", role: "Jefe de Auditoría" }],
    },
    "rol no permitido": { ...base, transitions: [{ ...base.transitions[0], role: "Gerente" }, base.transitions[1]] },
  };
  for (const [name, candidate] of Object.entries(variants)) {
    assert.equal(validateGeneratedWorkflow(candidate), null, name);
  }
});

test("RF-17 Gemini recibe solo la descripción y responde con structured output", async () => {
  let request;
  const client = {
    models: {
      async generateContent(options) {
        request = options;
        return { text: JSON.stringify({ summary: "s", states: [], transitions: [] }) };
      },
    },
  };
  const provider = createGeminiProvider({ client });
  await provider.generateWorkflow({ description: "Proceso de prueba" });
  assert.equal(request.contents, buildGeneratePrompt({ description: "Proceso de prueba" }));
  assert.deepEqual(JSON.parse(request.contents), { description: "Proceso de prueba" });
  assert.equal(request.config.responseMimeType, "application/json");
  assert.equal(provider.generatePromptVersion, "workflow-generate-v1");
});

test("fase 2: el flujo guardado acepta requisitos por transición y plazo por estado", () => {
  const stored = {
    size: { width: 400, height: 200 },
    states: [
      { id: "a", kind: "Inicial", name: "Borrador", tone: "neutral", position: { x: 0, y: 0 }, slaDays: 5 },
      { id: "b", kind: "Final", name: "Cerrado", tone: "green", position: { x: 200, y: 0 } },
    ],
    transitions: [
      {
        id: "t",
        label: "cerrar",
        from: "a",
        to: "b",
        role: "Jefe de Auditoría",
        variant: "default",
        requires: { evidence: true, comment: false },
      },
    ],
  };
  assert.deepEqual(parseWorkflow(stored).transitions[0].requires, { evidence: true, comment: false });
  assert.throws(
    () => parseWorkflow({ ...stored, states: [{ ...stored.states[0], slaDays: 0 }, stored.states[1]] }),
    /no es válido/,
  );
});
