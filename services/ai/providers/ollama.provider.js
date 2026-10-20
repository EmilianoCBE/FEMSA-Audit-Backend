// US15 - Emiliano Carrizales: proveedor hermético con un modelo abierto (Qwen) en Ollama.
// El modelo corre en la misma máquina o en un servidor de la red interna: el formulario nunca sale a internet.
import {
  buildDesignerPrompt,
  PROMPT_VERSION,
  RESPONSE_JSON_SCHEMA,
  SYSTEM_INSTRUCTION,
} from "../prompts/designer.v1.js";

export const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";
// Medido el 2026-10-19 en una MacBook M4 Pro (48 GB), con el modelo cargado: qwen3.5:9b 3.5–7.8 s y sugerencias variadas;
// qwen3:8b mejor formato pero 8–11 s (para un servidor con GPU); qwen3.5:4b rápido pero repetitivo.
export const DEFAULT_OLLAMA_MODEL = "qwen3.5:9b";
// En una laptop la velocidad depende de cuánto texto genera el modelo: con 3 sugerencias se cumple la meta de < 10 s.
const LOCAL_MAX_SUGGESTIONS = 3;
const LOCAL_INSTRUCTION = `\n\nEstás corriendo como modelo local: propón como máximo ${LOCAL_MAX_SUGGESTIONS} sugerencias, las más útiles.`;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** Solo la propia máquina o redes privadas (10.x, 172.16-31.x, 192.168.x): nada hacia internet. */
export function isInternalUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (!["http:", "https:"].includes(url.protocol)) return false;
  const host = url.hostname;
  if (LOCAL_HOSTS.has(host) || host.endsWith(".localhost")) return true;
  const [a, b] = host.split(".").map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

// Sin esquema forzado (motores que no lo soportan) se describe el formato con un ejemplo.
const FORMAT_HINT = `

Responde SOLO con JSON, exactamente con esta forma (sin texto antes ni después):
{"suggestions":[{"kind":"field","title":"Agregar la causa del hallazgo","reason":"Explica por qué ocurrió la desviación.","confidence":"media","change":{"op":"add-field","type":"long-text","label":"Causa","section":"evaluacion"}}]}`;

/** Corrige omisiones típicas de modelos locales; el esquema (zod) decide después qué se acepta. */
export function normalizeLocalSuggestion(suggestion) {
  if (!suggestion || typeof suggestion !== "object") return suggestion;
  const result = { ...suggestion };
  const change = result.change && typeof result.change === "object" ? { ...result.change } : undefined;
  if (change && !change.op) {
    if (change.fieldId && change.type) change.op = "change-field-type";
    else if (change.fieldId && typeof change.formula === "string") change.op = "set-formula";
    else if (change.fieldId && typeof change.required === "boolean") change.op = "set-required";
    else if (change.fieldId && change.label) change.op = "rename-field";
    else if (change.type && change.label) change.op = "add-field";
  }
  if (change) result.change = change;
  if (!["alta", "media", "baja"].includes(result.confidence)) result.confidence = "media";
  if (!result.title && typeof result.reason === "string") result.title = result.reason.split(/[.:]/)[0].slice(0, 100);
  return result;
}

function parseContent(text) {
  const clean = String(text ?? "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  return JSON.parse(clean);
}

/** `fetchImpl` se puede inyectar en las pruebas para no depender de Ollama. */
export function createOllamaProvider({
  baseUrl = DEFAULT_OLLAMA_URL,
  model = DEFAULT_OLLAMA_MODEL,
  fetchImpl = fetch,
} = {}) {
  if (!isInternalUrl(baseUrl)) throw new Error(`OLLAMA_URL debe ser local o de la red interna (recibido: ${baseUrl}).`);
  const endpoint = new URL("/api/chat", baseUrl).toString();
  let structured = true;

  async function chat(fields, known, signal) {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        model,
        stream: false,
        think: false,
        // Mantener el modelo en memoria entre análisis evita volver a cargarlo (varios segundos).
        keep_alive: "60m",
        options: { temperature: 0.2, num_predict: 900 },
        ...(structured && { format: RESPONSE_JSON_SCHEMA }),
        messages: [
          {
            role: "system",
            content: SYSTEM_INSTRUCTION + LOCAL_INSTRUCTION + (structured ? "" : FORMAT_HINT),
          },
          { role: "user", content: buildDesignerPrompt({ fields, known }) },
        ],
      }),
    });
    const body = await response.json().catch(() => ({}));
    return { response, body };
  }

  return {
    name: "ollama",

    /** Carga el modelo en memoria por adelantado para que el primer análisis no espere la carga. */
    async warmUp() {
      await fetchImpl(new URL("/api/generate", baseUrl).toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, keep_alive: "60m" }),
      });
    },
    model,
    promptVersion: PROMPT_VERSION,

    async suggestDesigner({ fields, known }, { signal } = {}) {
      let { response, body } = await chat(fields, known, signal);
      // Algunos motores (ej. MLX en Mac) no soportan el esquema: se recuerda y se pide con el ejemplo de formato.
      if (response.status === 501 && structured) {
        structured = false;
        ({ response, body } = await chat(fields, known, signal));
      }
      if (!response.ok) throw new Error(`Ollama respondió ${response.status}: ${body?.error ?? "sin detalle"}`);

      const raw = parseContent(body?.message?.content);
      const suggestions = Array.isArray(raw?.suggestions)
        ? raw.suggestions.map(normalizeLocalSuggestion).slice(0, LOCAL_MAX_SUGGESTIONS)
        : raw?.suggestions;
      return { suggestions };
    },
  };
}
