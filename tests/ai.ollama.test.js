import assert from "node:assert/strict";
import { test } from "node:test";
import { validateAiSuggestions } from "../services/ai/ai.service.js";
import { getAiProvider } from "../services/ai/providers/index.js";
import {
  createOllamaProvider,
  isInternalUrl,
  normalizeLocalSuggestion,
} from "../services/ai/providers/ollama.provider.js";

// fetch falso con la forma de la API de Ollama: el CI nunca necesita Ollama ni un modelo descargado.
function fakeFetch(replies) {
  const calls = [];
  const queue = [...replies];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), signal: init.signal });
    const { status = 200, body } = queue.shift() ?? {};
    return { ok: status < 400, status, json: async () => body };
  };
  return { fetchImpl, calls };
}

const fields = [
  { id: "titulo", type: "short-text", label: "Título", required: true, section: "identificacion", formula: null },
  {
    id: "plazo",
    type: "short-text",
    label: "Fecha compromiso",
    required: false,
    section: "remediacion",
    formula: null,
  },
];
const add = (label) => ({
  kind: "field",
  title: `Agregar ${label}`,
  reason: "Dato necesario para el seguimiento.",
  confidence: "media",
  change: { op: "add-field", type: "short-text", label, section: "remediacion" },
});

test("RNF-13 Ollama solo acepta la propia máquina o la red interna", () => {
  for (const url of [
    "http://127.0.0.1:11434",
    "http://localhost:11434",
    "http://10.0.0.5:11434",
    "http://192.168.1.20:11434",
    "http://172.20.0.2:11434",
  ]) {
    assert.equal(isInternalUrl(url), true, url);
  }
  for (const url of [
    "https://api.ollama.com",
    "http://8.8.8.8:11434",
    "http://172.40.0.1",
    "ftp://127.0.0.1",
    "no-es-url",
  ]) {
    assert.equal(isInternalUrl(url), false, url);
  }
  assert.throws(() => createOllamaProvider({ baseUrl: "https://ollama.example.com" }), /local o de la red interna/);
});

test("US18 con una URL externa el proveedor ollama queda no disponible (solo reglas)", async () => {
  const provider = getAiProvider({ AI_PROVIDER: "ollama", OLLAMA_URL: "https://ollama.example.com" });
  await assert.rejects(provider.suggestDesigner({ fields, known: [] }), /local o de la red interna/);
});

test("US15 pide JSON con esquema, sin razonamiento largo, temperatura baja y modelo cargado", async () => {
  const { fetchImpl, calls } = fakeFetch([
    { body: { message: { content: JSON.stringify({ suggestions: [add("Responsable")] }) } } },
  ]);
  const signal = new AbortController().signal;
  const provider = createOllamaProvider({ model: "qwen-prueba", fetchImpl });
  const raw = await provider.suggestDesigner({ fields, known: [] }, { signal });

  const [{ url, body }] = calls;
  assert.equal(url, "http://127.0.0.1:11434/api/chat");
  assert.equal(body.model, "qwen-prueba");
  assert.equal(body.format.required[0], "suggestions");
  assert.equal(body.think, false);
  assert.equal(body.stream, false);
  assert.ok(body.options.temperature <= 0.3);
  assert.equal(body.keep_alive, "60m");
  assert.match(body.messages[0].content, /Solo propones/);
  assert.match(body.messages[0].content, /máximo 3/);
  assert.equal(calls[0].signal, signal);
  assert.equal(validateAiSuggestions(raw, fields).length, 1);
});

test("si el motor no soporta el esquema (501), reintenta con un ejemplo de formato y lo recuerda", async () => {
  const content = "```json\n" + JSON.stringify({ suggestions: [add("Causa")] }) + "\n```";
  const { fetchImpl, calls } = fakeFetch([
    { status: 501, body: { error: "structured output is unavailable" } },
    { body: { message: { content } } },
    { body: { message: { content } } },
  ]);
  const provider = createOllamaProvider({ fetchImpl });
  const first = await provider.suggestDesigner({ fields, known: [] });
  await provider.suggestDesigner({ fields, known: [] });

  assert.equal(calls.length, 3);
  assert.ok(calls[0].body.format);
  assert.equal(calls[1].body.format, undefined);
  assert.match(calls[1].body.messages[0].content, /Responde SOLO con JSON/);
  assert.equal(calls[2].body.format, undefined, "ya no vuelve a intentar con esquema");
  assert.equal(validateAiSuggestions(first, fields).length, 1);
});

test("normaliza omisiones típicas de modelos locales y limita a 3 sugerencias", async () => {
  assert.deepEqual(
    normalizeLocalSuggestion({
      kind: "component",
      reason: "Usar fecha. Mejora la validación",
      change: { fieldId: "plazo", type: "date" },
    }),
    {
      kind: "component",
      title: "Usar fecha",
      reason: "Usar fecha. Mejora la validación",
      confidence: "media",
      change: { fieldId: "plazo", type: "date", op: "change-field-type" },
    },
  );
  assert.equal(normalizeLocalSuggestion({ change: { type: "date", label: "Fecha" } }).change.op, "add-field");

  const many = ["Causa", "Recomendación", "Responsable", "Área auditada", "Criterio"].map(add);
  const { fetchImpl } = fakeFetch([{ body: { message: { content: JSON.stringify({ suggestions: many }) } } }]);
  const raw = await createOllamaProvider({ fetchImpl }).suggestDesigner({ fields, known: [] });
  assert.equal(raw.suggestions.length, 3);
});

test("errores de Ollama y respuestas que no son JSON hacen fallar al proveedor (quedan las reglas)", async () => {
  const down = fakeFetch([{ status: 404, body: { error: "model not found" } }]);
  await assert.rejects(
    createOllamaProvider({ fetchImpl: down.fetchImpl }).suggestDesigner({ fields, known: [] }),
    /404/,
  );
  const text = fakeFetch([{ body: { message: { content: "no es json" } } }]);
  await assert.rejects(createOllamaProvider({ fetchImpl: text.fetchImpl }).suggestDesigner({ fields, known: [] }));
});

test("US15 no se proponen dos veces el mismo campo ni uno que ya existe", () => {
  const result = validateAiSuggestions(
    {
      suggestions: [
        add("Riesgo o severidad"),
        add("Severidad o riesgo"),
        add("Riesgo/Severidad"),
        add("Título"),
        add("Causa"),
      ],
    },
    fields,
  );
  assert.deepEqual(
    result.map((s) => s.change.label),
    ["Riesgo o severidad", "Causa"],
  );
});

test("US16 se descarta lo que repite una regla aunque el campo venga solo dentro de change", () => {
  const rule = {
    kind: "component",
    title: "Usar Fecha",
    reason: "r",
    confidence: "media",
    fieldId: "plazo",
    change: { op: "change-field-type", fieldId: "plazo", type: "date" },
  };
  const repeated = {
    kind: "component",
    title: "Cambiar a fecha",
    reason: "Formato correcto.",
    confidence: "media",
    change: { op: "change-field-type", fieldId: "plazo", type: "date" },
  };
  assert.deepEqual(validateAiSuggestions({ suggestions: [repeated] }, fields, [rule]), []);
});
