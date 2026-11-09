import assert from "node:assert/strict";
import { test } from "node:test";
import { getAiStatus } from "../services/ai/ai.service.js";
import {
  aiStatus,
  checkAiStatus,
  DEFAULT_RETRY_AFTER_MS,
  recordFailure,
  recordSuccess,
  retryAfterMs,
} from "../services/ai/availability.js";
import { getAiProvider } from "../services/ai/providers/index.js";

test("US18 tras una falla la IA queda en pausa y vuelve sola al terminar", () => {
  const provider = { name: "x" };
  const now = 1_000_000;
  assert.deepEqual(aiStatus(provider, { now }), { aiAvailable: true, reason: null, retryAt: null, lastFailure: null });

  recordFailure(provider, "timeout", now);
  assert.deepEqual(aiStatus(provider, { now: now + 1000, pauseMs: 60_000 }), {
    aiAvailable: false,
    reason: "paused",
    retryAt: new Date(now + 60_000).toISOString(),
    lastFailure: "timeout",
  });
  assert.equal(aiStatus(provider, { now: now + 60_000, pauseMs: 60_000 }).aiAvailable, true);

  recordFailure(provider, "error", now);
  recordSuccess(provider);
  assert.equal(aiStatus(provider, { now: now + 1, pauseMs: 60_000 }).aiAvailable, true);
});

test("US18 la pausa es por proveedor y se configura con AI_RETRY_AFTER_MS", () => {
  const a = { name: "a" };
  const b = { name: "b" };
  recordFailure(a, "error");
  assert.equal(aiStatus(b).aiAvailable, true);
  assert.equal(retryAfterMs({}), DEFAULT_RETRY_AFTER_MS);
  assert.equal(retryAfterMs({ AI_RETRY_AFTER_MS: "0" }), 0);
  assert.equal(retryAfterMs({ AI_RETRY_AFTER_MS: "abc" }), DEFAULT_RETRY_AFTER_MS);
  assert.equal(aiStatus(a, { pauseMs: 0 }).aiAvailable, true, "con 0 no hay pausa");
});

test("US18 sin llave de Gemini el estado dice que no está configurada", async () => {
  const provider = getAiProvider({ AI_PROVIDER: "gemini" });
  assert.deepEqual(await getAiStatus({ provider }), {
    aiAvailable: false,
    reason: "not-configured",
    retryAt: null,
    provider: "gemini",
  });
  assert.equal((await getAiStatus({ provider: getAiProvider({}) })).aiAvailable, true);
});

test("US18 la comprobación detecta una IA caída antes del primer análisis y queda en pausa", async () => {
  let checks = 0;
  const provider = {
    name: "llave-invalida",
    checkHealth: async () => {
      checks++;
      throw new Error("API key not valid");
    },
  };
  const status = await checkAiStatus(provider, { pauseMs: 60_000 });
  assert.equal(status.aiAvailable, false);
  assert.equal(status.reason, "paused");
  assert.equal(status.lastFailure, "error");
  // Durante la pausa no se vuelve a comprobar.
  await checkAiStatus(provider, { pauseMs: 60_000 });
  assert.equal(checks, 1);
  // Al terminar la pausa se comprueba otra vez.
  await checkAiStatus(provider, { pauseMs: 0 });
  assert.equal(checks, 2);
});

test("US18 una comprobación exitosa vale un minuto y las consultas simultáneas la comparten", async () => {
  let checks = 0;
  const provider = {
    name: "ok",
    checkHealth: () =>
      new Promise((resolve) => {
        checks++;
        setTimeout(resolve, 10);
      }),
  };
  const results = await Promise.all([checkAiStatus(provider), checkAiStatus(provider), checkAiStatus(provider)]);
  assert.ok(results.every((result) => result.aiAvailable));
  assert.equal(checks, 1);
  await checkAiStatus(provider);
  assert.equal(checks, 1, "dentro del minuto no se repite");
  await checkAiStatus(provider, { ttlMs: 0 });
  assert.equal(checks, 2);
});

test("US18 si la comprobación tarda, cuenta como timeout aunque el proveedor no la cancele", async () => {
  const provider = { name: "colgado", checkHealth: () => new Promise(() => {}) };
  const started = Date.now();
  const status = await checkAiStatus(provider, { timeoutMs: 30 });
  assert.equal(status.reason, "paused");
  assert.equal(status.lastFailure, "timeout");
  assert.ok(Date.now() - started < 1000);
});

test("US18 un proveedor sin comprobación usa solo configuración y fallas recientes", async () => {
  assert.equal((await checkAiStatus({ name: "simple" })).aiAvailable, true);
});
