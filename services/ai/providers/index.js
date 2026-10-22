import { createGeminiProvider, DEFAULT_GEMINI_MODEL } from "./gemini.provider.js";
import { mockProvider } from "./mock.provider.js";

/** Proveedor que no responde: la IA se reporta como no disponible y solo quedan las reglas (US18). */
const unavailableProvider = (name, reason) => ({
  name,
  promptVersion: null,
  async suggestDesigner() {
    throw new Error(reason);
  },
});

let geminiProvider;

/** Elige el proveedor según AI_PROVIDER. Sin variable, mock: nunca se llama a un servicio externo por accidente. */
export function getAiProvider(env = process.env) {
  const name = (env.AI_PROVIDER || "mock").trim().toLowerCase();
  if (name === "mock") return mockProvider;

  if (name === "gemini") {
    if (!env.GEMINI_API_KEY) return unavailableProvider(name, "Falta GEMINI_API_KEY en .env.");
    const model = env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
    // Un solo cliente por proceso (se reutiliza la conexión).
    if (geminiProvider?.model !== model) geminiProvider = createGeminiProvider({ apiKey: env.GEMINI_API_KEY, model });
    return geminiProvider;
  }

  return unavailableProvider(name, `El proveedor de IA "${name}" no está disponible.`);
}
