import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeDesigner, validateAiSuggestions } from "../services/ai/ai.service.js";
import { PROMPT_VERSION } from "../services/ai/prompts/designer.v1.js";
import { createGeminiProvider } from "../services/ai/providers/gemini.provider.js";
import { getAiProvider } from "../services/ai/providers/index.js";

// Cliente falso con la misma forma que @google/genai: el CI nunca llama a Google ni gasta créditos.
function fakeClient(reply) {
  const calls = [];
  return {
    calls,
    models: {
      async generateContent(request) {
        calls.push(request);
        return typeof reply === "function" ? reply(request) : { text: reply };
      },
    },
  };
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

test("US15 Gemini recibe instrucciones fijas, respuesta JSON con esquema y temperatura baja", async () => {
  const client = fakeClient(JSON.stringify({ suggestions: [] }));
  const provider = createGeminiProvider({ model: "modelo-prueba", client });
  const signal = new AbortController().signal;

  await provider.suggestDesigner(
    { fields, known: [{ title: "Ya detectado", fieldId: "plazo", reason: "x" }] },
    { signal },
  );

  const [request] = client.calls;
  assert.equal(request.model, "modelo-prueba");
  assert.equal(request.config.responseMimeType, "application/json");
  assert.equal(request.config.responseJsonSchema.required[0], "suggestions");
  assert.ok(request.config.temperature <= 0.3);
  assert.match(request.config.systemInstruction, /Solo propones/);
  assert.equal(request.config.abortSignal, signal);
  assert.equal(provider.promptVersion, PROMPT_VERSION);
});

test("RNF-13 al modelo solo va la estructura del formulario", async () => {
  const client = fakeClient(JSON.stringify({ suggestions: [] }));
  const withExtra = fields.map((field) => ({ ...field, valorCapturado: "dato sensible", auditor: "Ana" }));
  await createGeminiProvider({ client }).suggestDesigner({ fields: withExtra, known: [] });

  const sent = JSON.parse(client.calls[0].contents);
  assert.deepEqual(Object.keys(sent.fields[0]).sort(), ["formula", "id", "label", "required", "section", "type"]);
  assert.doesNotMatch(client.calls[0].contents, /dato sensible|Ana/);
});

test("US15 la respuesta de Gemini se convierte en sugerencias válidas", async () => {
  const reply = {
    suggestions: [
      {
        kind: "field",
        title: "Agregar el criterio incumplido",
        reason: "Sin el criterio no se sabe qué norma o política se incumplió.",
        confidence: "media",
        change: { op: "add-field", type: "long-text", label: "Criterio incumplido", section: "evaluacion" },
      },
    ],
  };
  const raw = await createGeminiProvider({ client: fakeClient(JSON.stringify(reply)) }).suggestDesigner({
    fields,
    known: [],
  });
  assert.deepEqual(validateAiSuggestions(raw, fields), reply.suggestions);
});

test("US18 si Gemini responde texto que no es JSON o vacío, la IA queda no disponible y siguen las reglas", async () => {
  for (const text of ["esto no es json", ""]) {
    const provider = createGeminiProvider({ client: fakeClient(text) });
    await assert.rejects(provider.suggestDesigner({ fields, known: [] }));
  }
});

test("US18 al vencer el tiempo se cancela la petición a Gemini", async () => {
  let receivedSignal;
  const client = fakeClient((request) => {
    receivedSignal = request.config.abortSignal;
    return new Promise(() => {});
  });
  const provider = createGeminiProvider({ client });
  const result = await analyzeDesigner("layout dummy", { provider, timeoutMs: 30 });

  assert.equal(result.aiAvailable, false);
  assert.equal(result.provider, "gemini");
  assert.equal(receivedSignal.aborted, true);
});

test("sin GEMINI_API_KEY el proveedor gemini se reporta como no disponible", async () => {
  const provider = getAiProvider({ AI_PROVIDER: "gemini" });
  await assert.rejects(provider.suggestDesigner({ fields, known: [] }), /GEMINI_API_KEY/);
  assert.equal(getAiProvider({}).name, "mock");
});
