import assert from "node:assert/strict";
import { after, before, mock, test } from "node:test";
import sql from "mssql";
import { versionsRepository } from "../repositories/versions.repository.js";
import { analyzeDesigner } from "../services/ai/ai.service.js";
import { SESSION_COOKIE, tokenHash } from "../utils/session.js";

// La BD solo se simula para la sesión; las versiones no tienen datos, así que el layout queda como se crea aquí.
const token = "e".repeat(64);
const sessionUser = {
  Id: "00000000-0000-4000-8000-000000000015",
  Name: "Emiliano Prueba",
  Role: "Administrador",
  RoleId: 2,
};
const headers = { Cookie: `${SESSION_COOKIE}=${token}`, "Content-Type": "application/json" };

let server;
let origin;
let originalConnect;
let appId;

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
  origin = `http://127.0.0.1:${server.address().port}/api`;

  const created = await fetch(`${origin}/designer/layouts`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: "Formulario de prueba",
      elements: [
        { id: "titulo", type: "short-text", x: 0, y: 0, width: 200, height: 40, config: { label: "Título" } },
        { id: "t1", type: "short-text", x: 0, y: 50, width: 200, height: 40, config: { label: "Texto corto" } },
        { id: "f1", type: "short-text", x: 0, y: 100, width: 200, height: 40, config: { label: "Fecha compromiso" } },
        { id: "c1", type: "calculated", x: 0, y: 150, width: 200, height: 40, config: { label: "Riesgo residual" } },
      ],
    }),
  });
  appId = (await created.json()).layout.id;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  sql.ConnectionPool.prototype.connect = originalConnect;
  mock.restoreAll();
  const { closeDB } = await import("../db/db.js");
  await closeDB();
});

const analyze = (body, extra = headers) =>
  fetch(`${origin}/ai/designer/analyze`, { method: "POST", headers: extra, body: JSON.stringify(body) });

test("US15-US17 el asistente pide sesión y rechaza otro origen", async () => {
  assert.equal((await analyze({ appId }, { "Content-Type": "application/json" })).status, 401);
  assert.equal((await analyze({ appId }, { ...headers, Origin: "https://otro.example" })).status, 403);
});

test("US15-US17 valida el formulario a analizar", async () => {
  assert.equal((await analyze({})).status, 400);
  assert.equal((await analyze({ appId: "x".repeat(101) })).status, 400);
  assert.equal((await analyze({ appId: "no-existe" })).status, 404);
});

test("US16 y US15 devuelven reglas e IA, todas explicadas y sin cambiar el formulario", async () => {
  const response = await analyze({ appId });
  assert.equal(response.status, 200);
  const body = await response.json();

  assert.equal(body.aiAvailable, true);
  assert.equal(body.provider, "mock");
  const titles = body.suggestions.map((s) => `${s.source}:${s.fieldId ?? "-"}`);
  assert.ok(titles.includes("rules:t1"), "etiqueta genérica");
  assert.ok(titles.includes("rules:f1"), "fecha capturada como texto");
  assert.ok(titles.includes("rules:c1"), "calculado sin fórmula");
  assert.ok(body.suggestions.some((s) => s.source === "ai"));
  assert.ok(body.suggestions.every((s) => s.id && s.reason && s.title));

  // US17: analizar no aplica nada.
  const layout = await (await fetch(`${origin}/designer/layouts/${appId}`, { headers })).json();
  assert.equal(layout.layout.elements.find((e) => e.id === "f1").type, "short-text");
});

test("US18 si la IA falla o tarda, responde solo con reglas y aiAvailable false", async () => {
  const slow = { name: "lento", promptVersion: "x", suggestDesigner: () => new Promise(() => {}) };
  const broken = { name: "roto", promptVersion: "x", suggestDesigner: async () => Promise.reject(new Error("500")) };

  for (const provider of [slow, broken]) {
    const started = Date.now();
    const result = await analyzeDesigner(appId, { provider, timeoutMs: 50 });
    assert.equal(result.aiAvailable, false);
    assert.ok(result.suggestions.length > 0);
    assert.ok(result.suggestions.every((s) => s.source === "rules"));
    assert.ok(Date.now() - started < 1000);
  }
});

test("US18 dice por qué no hay IA y, tras una falla, deja de llamarla un rato", async () => {
  let calls = 0;
  const broken = {
    name: "roto",
    promptVersion: "x",
    suggestDesigner: async () => {
      calls++;
      throw new Error("503");
    },
  };
  const first = await analyzeDesigner(appId, { provider: broken, timeoutMs: 50 });
  assert.equal(first.aiAvailable, false);
  assert.equal(first.aiUnavailableReason, "error");
  assert.ok(Date.parse(first.aiRetryAt) > Date.now());
  assert.equal(calls, 1);

  // Mientras dura la pausa no se llama a la IA: responden las reglas al instante.
  const second = await analyzeDesigner(appId, { provider: broken, timeoutMs: 50 });
  assert.equal(second.aiUnavailableReason, "paused");
  assert.equal(second.aiRetryAt, first.aiRetryAt);
  assert.equal(calls, 1);
  assert.ok(second.suggestions.length > 0 && second.suggestions.every((s) => s.source === "rules"));

  const slow = { name: "lento", promptVersion: "x", suggestDesigner: () => new Promise(() => {}) };
  assert.equal((await analyzeDesigner(appId, { provider: slow, timeoutMs: 30 })).aiUnavailableReason, "timeout");

  const missing = { name: "gemini", promptVersion: null, configured: false, suggestDesigner: broken.suggestDesigner };
  const notConfigured = await analyzeDesigner(appId, { provider: missing, timeoutMs: 50 });
  assert.equal(notConfigured.aiUnavailableReason, "not-configured");
  assert.equal(notConfigured.aiRetryAt, null);
  assert.equal(calls, 1, "si no está configurada ni se intenta");
});

test("US18 con IA disponible no hay motivo de falla", async () => {
  const result = await analyzeDesigner(appId);
  assert.equal(result.aiAvailable, true);
  assert.equal(result.aiUnavailableReason, null);
  assert.equal(result.aiRetryAt, null);
});

test("US18 GET /ai/status pide sesión e informa sin llamar a la IA", async () => {
  assert.equal((await fetch(`${origin}/ai/status`)).status, 401);
  const response = await fetch(`${origin}/ai/status`, { headers });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { aiAvailable: true, reason: null, retryAt: null, provider: "mock" });
});
