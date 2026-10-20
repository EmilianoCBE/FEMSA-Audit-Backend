// US15: verifica el proveedor de IA configurado (Gemini u Ollama) sin mostrar llaves. Uso: npm run ai:check
// Para usar otro .env: DOTENV_CONFIG_PATH=/ruta/.env npm run ai:check
import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
import { validateAiSuggestions } from "../services/ai/ai.service.js";
import { createGeminiProvider, DEFAULT_GEMINI_MODEL } from "../services/ai/providers/gemini.provider.js";
import {
  createOllamaProvider,
  DEFAULT_OLLAMA_MODEL,
  DEFAULT_OLLAMA_URL,
  isInternalUrl,
} from "../services/ai/providers/ollama.provider.js";
import { runDesignerRules } from "../services/ai/rules/designer.rules.js";

const providerName = (process.env.AI_PROVIDER || "mock").trim().toLowerCase();
console.log(`AI_PROVIDER: ${process.env.AI_PROVIDER || "mock (por defecto)"}`);

/** Prepara el proveedor real a revisar; regresa null si falta configuración. */
async function setUpProvider() {
  if (providerName === "ollama") {
    const baseUrl = process.env.OLLAMA_URL?.trim() || DEFAULT_OLLAMA_URL;
    const model = process.env.OLLAMA_MODEL?.trim() || DEFAULT_OLLAMA_MODEL;
    console.log(
      `OLLAMA_URL: ${baseUrl} (${isInternalUrl(baseUrl) ? "local / red interna ✔" : "NO permitida: debe ser local"})`,
    );
    console.log(`Modelo: ${model}`);
    if (!isInternalUrl(baseUrl)) return null;
    try {
      const { models = [] } = await (await fetch(new URL("/api/tags", baseUrl))).json();
      const names = models.map((item) => item.name);
      console.log(`Modelos descargados: ${names.join(", ") || "ninguno"}`);
      if (!names.includes(model)) {
        console.log(`\nFalta el modelo. Descárgalo con: ollama pull ${model}`);
        return null;
      }
    } catch {
      console.log("\nOllama no responde. Inícialo con: ollama serve (o la app de Ollama)");
      return null;
    }
    const provider = createOllamaProvider({ baseUrl, model });
    process.stdout.write("Cargando el modelo en memoria... ");
    const started = Date.now();
    await provider.warmUp();
    console.log(`${Date.now() - started} ms`);
    return provider;
  }

  if (providerName === "gemini") {
    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
    console.log(`GEMINI_API_KEY: ${apiKey ? "configurada" : "FALTA"}`);
    console.log(`Modelo: ${model}`);
    if (!apiKey) {
      console.log("\nAgrega GEMINI_API_KEY=... a tu .env (https://aistudio.google.com/apikey) y vuelve a correr.");
      return null;
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
    return createGeminiProvider({ apiKey, model, client: ai });
  }

  console.log("\nCon AI_PROVIDER=mock no hay nada que verificar: usa gemini u ollama.");
  return null;
}

const provider = await setUpProvider();
if (!provider) process.exit(1);

// Formulario de ejemplo, sintético (no son datos de FEMSA).
const field = (id, type, label, section, required = false) => ({ id, type, label, required, section, formula: null });
const fields = [
  field("titulo", "short-text", "Título del hallazgo", "identificacion", true),
  field("desc", "short-text", "Descripción de la condición", "evaluacion", true),
  field("riesgo", "calculated", "Riesgo residual", "evaluacion"),
  field("plazo", "short-text", "Fecha compromiso", "remediacion"),
];
const known = runDesignerRules(fields);

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
  console.log(`\nLa llamada a ${provider.name} falló después de ${Date.now() - started} ms: ${error.message}`);
  process.exitCode = 1;
}
