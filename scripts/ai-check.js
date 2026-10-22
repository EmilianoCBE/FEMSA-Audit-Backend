// US15: verifica la conexión con Gemini sin mostrar la llave. Uso: npm run ai:check
// Para usar otro .env: DOTENV_CONFIG_PATH=/ruta/.env npm run ai:check
import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
import { validateAiSuggestions } from "../services/ai/ai.service.js";
import { createGeminiProvider, DEFAULT_GEMINI_MODEL } from "../services/ai/providers/gemini.provider.js";
import { runDesignerRules } from "../services/ai/rules/designer.rules.js";

const apiKey = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;

console.log(`AI_PROVIDER: ${process.env.AI_PROVIDER || "mock (por defecto)"}`);
console.log(`GEMINI_API_KEY: ${apiKey ? "configurada" : "FALTA"}`);
console.log(`Modelo: ${model}`);
if (!apiKey) {
  console.log("\nAgrega GEMINI_API_KEY=... a tu .env (https://aistudio.google.com/apikey) y vuelve a correr.");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });
try {
  const flash = [];
  for await (const item of await ai.models.list()) {
    if (/flash/i.test(item.name ?? "")) flash.push(item.name.replace(/^models\//, ""));
  }
  console.log(`Modelos Flash disponibles para tu llave (${flash.length}): ${flash.slice(0, 12).join(", ")}`);
} catch (error) {
  console.log(`No se pudieron listar los modelos: ${error.message}`);
}

// Formulario de ejemplo, sintético (no son datos de FEMSA).
const fields = [
  {
    id: "titulo",
    type: "short-text",
    label: "Título del hallazgo",
    required: true,
    section: "identificacion",
    formula: null,
  },
  {
    id: "desc",
    type: "short-text",
    label: "Descripción de la condición",
    required: true,
    section: "evaluacion",
    formula: null,
  },
  { id: "riesgo", type: "calculated", label: "Riesgo residual", required: false, section: "evaluacion", formula: null },
  {
    id: "plazo",
    type: "short-text",
    label: "Fecha compromiso",
    required: false,
    section: "remediacion",
    formula: null,
  },
];
const known = runDesignerRules(fields);
const provider = createGeminiProvider({ apiKey, model, client: ai });

const started = Date.now();
try {
  const raw = await provider.suggestDesigner({ fields, known });
  const latencyMs = Date.now() - started;
  const valid = validateAiSuggestions(raw, fields, known);
  console.log(
    `\nRespuesta en ${latencyMs} ms (meta < 10000). Sugerencias: ${raw.suggestions?.length ?? 0}, válidas: ${valid.length}`,
  );
  for (const suggestion of valid) {
    console.log(`- [${suggestion.kind}/${suggestion.confidence}] ${suggestion.title}`);
    console.log(`  Por qué: ${suggestion.reason}`);
    if (suggestion.change) console.log(`  Cambio: ${JSON.stringify(suggestion.change)}`);
  }
} catch (error) {
  console.log(`\nLa llamada a Gemini falló después de ${Date.now() - started} ms: ${error.message}`);
  process.exitCode = 1;
}
