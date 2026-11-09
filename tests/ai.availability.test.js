import assert from "node:assert/strict";
import { test } from "node:test";
import { getAiStatus } from "../services/ai/ai.service.js";
import {
  aiStatus,
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

test("US18 sin llave de Gemini el estado dice que no está configurada", () => {
  const provider = getAiProvider({ AI_PROVIDER: "gemini" });
  assert.deepEqual(getAiStatus({ provider }), {
    aiAvailable: false,
    reason: "not-configured",
    retryAt: null,
    provider: "gemini",
  });
  assert.equal(getAiStatus({ provider: getAiProvider({}) }).aiAvailable, true);
});
