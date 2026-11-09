// US18 - Continuidad sin IA (Karla Alessandra; implementación inicial: Emiliano Carrizales).
// Si la IA falla o tarda, se deja de llamar durante un rato: los siguientes análisis responden al instante solo con
// las reglas, en lugar de esperar el tiempo límite cada vez. El estado vive en memoria (por instancia del servidor).

export const DEFAULT_RETRY_AFTER_MS = 60_000;

/** Motivos por los que la IA no está disponible; el front muestra un mensaje distinto para cada uno. */
export const AI_UNAVAILABLE_REASONS = ["not-configured", "timeout", "error", "paused"];

const failures = new WeakMap();

export const retryAfterMs = (env = process.env) => {
  const value = Number(env.AI_RETRY_AFTER_MS);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_RETRY_AFTER_MS;
};

export function recordFailure(provider, reason, now = Date.now()) {
  failures.set(provider, { reason, at: now });
}

export function recordSuccess(provider) {
  failures.delete(provider);
}

/**
 * Estado de la IA sin llamarla: no configurada, en pausa tras una falla reciente o disponible.
 * "Disponible" significa configurada y sin fallas recientes; si responde se sabe hasta el siguiente análisis.
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
