// US15 - Emiliano Carrizales: proveedor real con Gemini (Google AI Studio).
// La llave vive solo en el backend (.env); el navegador nunca la ve.
import { GoogleGenAI } from "@google/genai";
import {
  buildDesignerPrompt,
  PROMPT_VERSION,
  RESPONSE_JSON_SCHEMA,
  SYSTEM_INSTRUCTION,
} from "../prompts/designer.v1.js";

export const DEFAULT_GEMINI_MODEL = "gemini-flash-latest";

/** `client` se puede inyectar en las pruebas para no llamar a Google. */
export function createGeminiProvider({ apiKey, model = DEFAULT_GEMINI_MODEL, client } = {}) {
  const ai = client ?? new GoogleGenAI({ apiKey });

  return {
    name: "gemini",
    model,
    promptVersion: PROMPT_VERSION,

    async suggestDesigner({ fields, known }, { signal } = {}) {
      const response = await ai.models.generateContent({
        model,
        contents: buildDesignerPrompt({ fields, known }),
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          // Baja: queremos respuestas consistentes, no creativas.
          temperature: 0.2,
          maxOutputTokens: 2048,
          responseMimeType: "application/json",
          responseJsonSchema: RESPONSE_JSON_SCHEMA,
          abortSignal: signal,
        },
      });

      const text = response.text;
      if (!text) throw new Error("Gemini respondió sin contenido.");
      return JSON.parse(text);
    },
  };
}
