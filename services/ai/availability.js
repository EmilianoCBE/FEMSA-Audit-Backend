// US18 - Continuidad sin IA (Karla Alessandra; implementación inicial: Emiliano Carrizales).
// Si la IA falla o tarda, se deja de llamar durante un rato: los siguientes análisis responden al instante solo con
// las reglas, en lugar de esperar el tiempo límite cada vez. El estado vive en memoria (por instancia del servidor).

export const DEFAULT_RETRY_AFTER_MS = 60_000;
/** Cuánto vale una comprobación exitosa antes de volver a preguntarle a la IA. */
export const HEALTH_TTL_MS = 60_000;
/** Límite de la comprobación: es una consulta ligera, si tarda más la IA no está en condiciones. */
export const HEALTH_TIMEOUT_MS = 4000;

/** Motivos por los que la IA no está disponible; el front muestra un mensaje distinto para cada uno. */
export const AI_UNAVAILABLE_REASONS = ["not-configured", "timeout", "error", "paused"];

const failures = new WeakMap();
const healthyAt = new WeakMap();
const probes = new WeakMap();

export const retryAfterMs = (env = process.env) => {
  const value = Number(env.AI_RETRY_AFTER_MS);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_RETRY_AFTER_MS;
};

export function recordFailure(provider, reason, now = Date.now()) {
  failures.set(provider, { reason, at: now });
  healthyAt.delete(provider);
}

export function recordSuccess(provider, now = Date.now()) {
  failures.delete(provider);
  healthyAt.set(provider, now);
}

/**
 * Estado de la IA sin llamarla: no configurada, en pausa tras una falla reciente o disponible (configurada y sin fallas
 * recientes). `checkAiStatus` además la comprueba.
 */
export function aiStatus(provider, { now = Date.now(), pauseMs = retryAfterMs() } = {}) {
  if (provider.configured === false) {
    return { aiAvailable: false, reason: "not-configured", retryAt: null, lastFailure: null };
  }
  const failure = failures.get(provider);
  if (failure && now - failure.at < pauseMs) {
    return {
      aiAvailable: false,
      reason: "paused",
      retryAt: new Date(failure.at + pauseMs).toISOString(),
      lastFailure: failure.reason,
    };
  }
  return { aiAvailable: true, reason: null, retryAt: null, lastFailure: null };
}

const isTimeout = (error) => error?.name === "TimeoutError" || error?.name === "AbortError";

/**
 * Como `aiStatus`, pero si nadie ha comprobado la IA en el último minuto le hace una consulta ligera
 * (`provider.checkHealth`, sin generar texto). Así, recién arrancado el servidor o con una llave inválida, el estado ya
 * dice la verdad antes del primer análisis. Varias consultas a la vez comparten la misma comprobación.
 */
export async function checkAiStatus(
  provider,
  { pauseMs = retryAfterMs(), ttlMs = HEALTH_TTL_MS, timeoutMs = HEALTH_TIMEOUT_MS } = {},
) {
  const current = aiStatus(provider, { pauseMs });
  if (!current.aiAvailable || typeof provider.checkHealth !== "function") return current;
  const last = healthyAt.get(provider);
  if (last !== undefined && Date.now() - last < ttlMs) return current;

  let probe = probes.get(provider);
  if (!probe) {
    let timer;
    // Aunque el proveedor ignore la señal, la comprobación no espera más del límite.
    const limit = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new DOMException("La comprobación tardó demasiado.", "TimeoutError")), timeoutMs);
    });
    probe = Promise.race([
      Promise.resolve().then(() => provider.checkHealth({ signal: AbortSignal.timeout(timeoutMs) })),
      limit,
    ])
      .then(
        () => recordSuccess(provider),
        (error) => recordFailure(provider, isTimeout(error) ? "timeout" : "error"),
      )
      .finally(() => {
        clearTimeout(timer);
        probes.delete(provider);
      });
    probes.set(provider, probe);
  }
  await probe;
  return aiStatus(provider, { pauseMs });
}
