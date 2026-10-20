import { mockProvider } from "./mock.provider.js";

/** Proveedor que no responde: la IA se reporta como no disponible y solo quedan las reglas (US18). */
const unavailableProvider = (name, reason) => ({
  name,
  promptVersion: null,
  async suggestDesigner() {
    throw new Error(reason);
  },
});

/** Elige el proveedor según AI_PROVIDER. Sin variable, mock: nunca se llama a un servicio externo por accidente. */
export function getAiProvider(env = process.env) {
  const name = (env.AI_PROVIDER || "mock").trim().toLowerCase();
  if (name === "mock") return mockProvider;
  // El proveedor de Gemini se agrega en la fase 4 (PLAN-IA.md §0).
  return unavailableProvider(name, `El proveedor de IA "${name}" no está disponible.`);
}
