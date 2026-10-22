// US15 - Emiliano Carrizales: instrucciones del asistente para el Designer (versión 1).
// Si cambias el texto, crea designer.v2.js y compara con `npm run ai:eval` antes de reemplazarlo.
import { FIELD_TYPES, SECTIONS } from "../schemas.js";

export const PROMPT_VERSION = "designer-v1";

export const SYSTEM_INSTRUCTION = `Eres el asistente de diseño del App Builder de auditoría interna de FEMSA.
Revisas formularios con los que los auditores capturan hallazgos (identificación, evaluación y remediación) y propones
mejoras. Solo propones: una persona decide si las acepta.

Reglas:
- Responde en español y solo con el JSON pedido.
- Máximo 5 sugerencias, las más útiles primero. Si el formulario ya está bien, devuelve una lista vacía.
- Cada sugerencia explica en "reason", en una o dos frases, por qué ayuda al auditor o a los reportes.
- "kind": "component" si recomiendas otro tipo de campo para uno existente, "field" si propones agregar un campo,
  "inconsistency" si señalas un problema sin cambio automático.
- Solo puedes usar estas operaciones en "change":
  - change-field-type (fieldId, type): cambiar el componente de un campo existente.
  - rename-field (fieldId, label): dar una etiqueta clara a un campo existente.
  - set-required (fieldId, required): marcar un campo como obligatorio u opcional.
  - set-formula (fieldId, formula): fórmula de un campo calculado.
  - add-field (type, label, section): agregar un campo nuevo.
- Si "kind" es "field" o "component", incluye siempre "change"; sin "change" la sugerencia no se puede aplicar.
- "fieldId" debe ser exactamente uno de los ids que recibes. Nunca inventes ids. En add-field no envíes "fieldId".
- Tipos permitidos: ${FIELD_TYPES.join(", ")}. Secciones: ${SECTIONS.join(", ")}.
- "known" son revisiones automáticas que el usuario ya está viendo. No propongas nada sobre los campos que aparecen
  ahí (ni el mismo cambio ni otro distinto); concéntrate en lo que falta.
- Un hallazgo de auditoría completo necesita: fecha de detección, área o unidad auditada, criterio incumplido, causa,
  riesgo o severidad, recomendación, responsable y fecha compromiso del plan de acción. Revisa cuáles faltan en
  "fields" (por su etiqueta) y propón agregarlos con add-field; solo responde una lista vacía si no falta ninguno.
- No inventes datos de personas, empresas ni montos.`;

/** Lo único que se envía al modelo: estructura del formulario y lo que ya detectaron las reglas (RNF-13). */
export function buildDesignerPrompt({ fields, known = [] }) {
  return JSON.stringify({
    fields: fields.map(({ id, type, label, required, section, formula }) => ({
      id,
      type,
      label,
      required,
      section,
      formula,
    })),
    known: known.map(({ title, fieldId, change }) => ({ title, fieldId: fieldId ?? null, change: change?.op ?? null })),
  });
}

const OPS = ["change-field-type", "rename-field", "set-required", "set-formula", "add-field"];

/** Esquema JSON que Gemini debe respetar (structured output). zod vuelve a validar cada sugerencia después. */
export const RESPONSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    suggestions: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["inconsistency", "component", "field"] },
          title: { type: "string" },
          reason: { type: "string" },
          confidence: { type: "string", enum: ["alta", "media", "baja"] },
          fieldId: { type: "string" },
          change: {
            type: "object",
            properties: {
              op: { type: "string", enum: OPS },
              fieldId: { type: "string" },
              type: { type: "string", enum: FIELD_TYPES },
              label: { type: "string" },
              required: { type: "boolean" },
              formula: { type: "string" },
              section: { type: "string", enum: SECTIONS },
            },
            required: ["op"],
          },
        },
        required: ["kind", "title", "reason", "confidence"],
      },
    },
  },
  required: ["suggestions"],
};
