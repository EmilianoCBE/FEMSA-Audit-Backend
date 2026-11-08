import { createGeminiProvider, DEFAULT_GEMINI_MODEL } from "./gemini.provider.js";
import { mockProvider } from "./mock.provider.js";
import { createOllamaProvider, DEFAULT_OLLAMA_MODEL, DEFAULT_OLLAMA_URL } from "./ollama.provider.js";

/** Proveedor que no responde: la IA se reporta como no disponible y solo quedan las reglas (US18). */
const unavailableProvider = (name, reason) => ({
  name,
  promptVersion: null,
  async suggestDesigner() {
    throw new Error(reason);
  },
});

let geminiProvider;
let ollamaProvider;

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

  // Hermético: modelo abierto (Qwen) en Ollama, en la misma máquina o en la red interna.
  if (name === "ollama") {
    const baseUrl = env.OLLAMA_URL?.trim() || DEFAULT_OLLAMA_URL;
    const model = env.OLLAMA_MODEL?.trim() || DEFAULT_OLLAMA_MODEL;
    if (ollamaProvider?.model !== model || ollamaProvider?.baseUrl !== baseUrl) {
      try {
        ollamaProvider = { ...createOllamaProvider({ baseUrl, model }), baseUrl };
        // Se carga el modelo en segundo plano para que el primer "Analizar" no espere la carga.
        ollamaProvider.warmUp().catch(() => {});
      } catch (error) {
        return unavailableProvider(name, error.message);
      }
    }
    return ollamaProvider;
  }

  return unavailableProvider(name, `El proveedor de IA "${name}" no está disponible.`);
}
