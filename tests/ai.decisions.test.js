import assert from "node:assert/strict";
import { after, before, beforeEach, mock, test } from "node:test";
import sql from "mssql";
import { aiRecommendationsRepository } from "../repositories/aiRecommendations.repository.js";
import { versionsRepository } from "../repositories/versions.repository.js";
import { SESSION_COOKIE, tokenHash } from "../utils/session.js";

// La BD solo se simula para la sesión; el repositorio de recomendaciones se reemplaza por uno en memoria.
const token = "f".repeat(64);
const sessionUser = {
  Id: "00000000-0000-4000-8000-000000000017",
  Name: "Emiliano Prueba",
  Role: "Administrador",
  RoleId: 2,
};
const headers = { Cookie: `${SESSION_COOKIE}=${token}`, "Content-Type": "application/json" };

let server;
let api;
let originalConnect;
let appId;
let rows;

function useInMemoryRepository() {
  rows = [];
  mock.method(aiRecommendationsRepository, "createMany", async ({ appId: app, analysisId, suggestions, ...rest }) =>
    suggestions.map((suggestion) => {
      const row = {
        ...structuredClone(suggestion),
        id: String(rows.length + 1),
        appId: app,
        analysisId,
        status: "pending",
        appliedChange: null,
        ...rest,
      };
      rows.push(row);
      return structuredClone(row);
    }),
  );
  mock.method(aiRecommendationsRepository, "findById", async (id) =>
    structuredClone(rows.find((row) => row.id === String(id)) ?? null),
  );
  mock.method(aiRecommendationsRepository, "decide", async (id, { status, appliedChange, decidedBy }) => {
    const row = rows.find((candidate) => candidate.id === String(id) && candidate.status === "pending");
    if (!row) return null;
    Object.assign(row, { status, appliedChange, decidedBy });
    return structuredClone(row);
  });
  mock.method(aiRecommendationsRepository, "metrics", async (app) => {
    const groups = new Map();
    for (const row of rows.filter((candidate) => candidate.appId === app)) {
      const key = `${row.source}:${row.status}`;
      const group = groups.get(key) ?? {
        source: row.source,
        status: row.status,
        total: 0,
        avgLatencyMs: row.latencyMs,
      };
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
  mock.method(versionsRepository, "list", async () => []);
  originalConnect = sql.ConnectionPool.prototype.connect;
  sql.ConnectionPool.prototype.connect = async () => ({
    close: async () => {},
    request() {
      const values = {};
      return {
        input(name, type, value) {
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

  const created = await fetch(`${api}/designer/layouts`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: "Formulario para decisiones",
      elements: [
        { id: "t1", type: "short-text", x: 0, y: 0, width: 200, height: 40, config: { label: "Texto corto" } },
        { id: "f1", type: "short-text", x: 0, y: 50, width: 200, height: 40, config: { label: "Fecha compromiso" } },
      ],
    }),
  });
  appId = (await created.json()).layout.id;
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

const analyze = async () =>
  (await fetch(`${api}/ai/designer/analyze`, { method: "POST", headers, body: JSON.stringify({ appId }) })).json();
const decide = (id, body) =>
  fetch(`${api}/ai/recommendations/${id}/decision`, { method: "POST", headers, body: JSON.stringify(body) });

test("US17 al analizar se guardan las sugerencias con quién las pidió y se devuelven con su id", async () => {
  const result = await analyze();

  assert.equal(result.recorded, true);
  assert.equal(rows.length, result.suggestions.length);
  assert.deepEqual(
    result.suggestions.map((s) => s.id),
    rows.map((r) => r.id),
  );
  const call = aiRecommendationsRepository.createMany.mock.calls[0].arguments[0];
  assert.equal(call.requestedBy, sessionUser.Id);
  assert.equal(call.provider, "mock");
  assert.ok(call.analysisId);
});

test("US17 aceptar, rechazar y reemplazar quedan registrados con quién decidió", async () => {
  const { suggestions } = await analyze();
  const withChange = suggestions.filter((s) => s.change);
  const component = withChange.find((s) => s.change.op === "change-field-type");
  const field = withChange.find((s) => s.change.op === "add-field");
  const inconsistency = suggestions.find((s) => !s.change);

  const accepted = await decide(component.id, { decision: "accepted" });
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).recommendation.status, "accepted");

  const replacement = { op: "add-field", type: "date", label: "Fecha en que se detectó", section: "identificacion" };
  const replaced = await (await decide(field.id, { decision: "replaced", change: replacement })).json();
  assert.equal(replaced.recommendation.status, "replaced");
  assert.deepEqual(replaced.recommendation.appliedChange, replacement);

  assert.equal((await decide(inconsistency.id, { decision: "rejected" })).status, 200);
  assert.ok(rows.filter((r) => r.status !== "pending").every((r) => r.decidedBy === sessionUser.Id));
});

test("US17 una sugerencia se decide una sola vez y se validan los datos", async () => {
  const { suggestions } = await analyze();
  const withChange = suggestions.find((s) => s.change);
  const withoutChange = suggestions.find((s) => !s.change);

  assert.equal((await decide(withChange.id, { decision: "rejected" })).status, 200);
  assert.equal((await decide(withChange.id, { decision: "accepted" })).status, 409);
  assert.equal((await decide(withoutChange.id, { decision: "accepted" })).status, 400);
  assert.equal((await decide(withoutChange.id, { decision: "quizas" })).status, 400);
  assert.equal((await decide(withoutChange.id, { decision: "replaced", change: { op: "borrar-todo" } })).status, 400);
  assert.equal((await decide("999", { decision: "rejected" })).status, 404);
  assert.equal((await decide("abc", { decision: "rejected" })).status, 404);
});

test("las decisiones piden sesión y mismo origen", async () => {
  const body = JSON.stringify({ decision: "rejected" });
  const noSession = await fetch(`${api}/ai/recommendations/1/decision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const otherOrigin = await fetch(`${api}/ai/recommendations/1/decision`, {
    method: "POST",
    headers: { ...headers, Origin: "https://otro.example" },
    body,
  });
  assert.equal(noSession.status, 401);
  assert.equal(otherOrigin.status, 403);
});

test("si no se puede guardar, el asistente responde igual con recorded false", async () => {
  mock.method(aiRecommendationsRepository, "createMany", async () => {
    throw new Error("BD no disponible");
  });
  const result = await analyze();
  assert.equal(result.recorded, false);
  assert.ok(result.suggestions.length > 0);
  assert.ok(result.suggestions.every((s) => /^(rules|ai)-\d+$/.test(s.id)));
});

test("métricas de aceptación por origen", async () => {
  const { suggestions } = await analyze();
  const ai = suggestions.find((s) => s.source === "ai");
  const rules = suggestions.filter((s) => s.source === "rules");
  await decide(ai.id, { decision: "accepted" });
  await decide(rules[0].id, { decision: "rejected" });

  const response = await fetch(`${api}/ai/designer/metrics?appId=${encodeURIComponent(appId)}`, { headers });
  assert.equal(response.status, 200);
  const metrics = await response.json();
  assert.equal(metrics.bySource.ai.accepted, 1);
  assert.equal(metrics.acceptanceRate.ai, 1);
  assert.equal(metrics.bySource.rules.rejected, 1);
  assert.equal(metrics.bySource.rules.pending, rules.length - 1);
  assert.equal(metrics.acceptanceRate.rules, 0);
  assert.equal(typeof metrics.avgAiLatencyMs, "number");
  assert.equal((await fetch(`${api}/ai/designer/metrics`, { headers })).status, 400);
});
