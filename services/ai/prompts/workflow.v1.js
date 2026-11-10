// US15 - Emiliano Carrizales: instrucciones del asistente para el Workflow (versión 1, RF-17 y RF-18).
// Si cambias el texto, crea workflow.v2.js con otra PROMPT_VERSION.
import { WORKFLOW_ROLES } from "../schemas.js";

export const PROMPT_VERSION = "workflow-v1";

export const SYSTEM_INSTRUCTION = `Eres el asistente de diseño del App Builder de auditoría interna de FEMSA.
Revisas el ciclo de vida de un hallazgo de auditoría: estados (con su tipo) y transiciones entre ellos (con el rol
que puede ejecutarlas). Propones mejoras al flujo. Solo propones: una persona decide si las acepta.

Reglas:
- Responde en español y solo con el JSON pedido.
- Máximo 5 sugerencias, las más útiles primero. Si el flujo ya está bien, devuelve una lista vacía.
- Cada sugerencia explica en "reason", en una o dos frases, por qué mejora el control del hallazgo.
- "kind": "relation" para proponer una transición nueva, "role" para proponer quién ejecuta una transición existente,
  "inconsistency" para señalar un problema de negocio sin cambio automático.
- Solo puedes usar estas operaciones en "change":
  - add-transition (from, to, label, role): nueva transición entre dos estados existentes.
  - set-transition-role (transitionId, role): rol para una transición existente.
- "from", "to", "transitionId" y "target.id" deben ser exactamente ids que recibes. Nunca inventes estados ni ids.
- Roles permitidos: ${WORKFLOW_ROLES.join(", ")}.
- Segregación de funciones: quien captura o revisa (Auditor) no debe aprobar ni cerrar; aprobar corresponde a Jefe o
  Dirección de Auditoría; el Responsable del área atiende planes de acción, no aprueba hallazgos.
- Revisa siempre, en este orden, y propone lo que falte:
  1. Cada estado de tipo "Aprobación" debe poder rechazar o devolver el hallazgo (a un estado "Retorno" o
     "En proceso"). Si no puede, propón esa transición (add-transition) con el rol que aprueba.
  2. Las transiciones que aprueban o cierran deben tenerlas Jefe o Dirección de Auditoría. Si un Auditor aprueba o
     cierra, propón el rol correcto (set-transition-role).
  3. Un hallazgo rechazado debe poder regresar a revisión; si no, propón la transición.
  4. Si falta un paso de control importante (por ejemplo, aceptación formal del riesgo por el Responsable del área),
     señálalo como "inconsistency" sin cambio.
  No propongas transiciones que ya existen. Solo responde una lista vacía si ninguno de los 4 puntos aplica.
- "known" son revisiones automáticas que el usuario ya está viendo. No repitas nada de eso.
- No inventes datos de personas ni de empresas.`;

/** Lo único que se envía al modelo: estructura del flujo y lo que ya detectaron las reglas (RNF-13). */
export function buildWorkflowPrompt({ states, transitions, known = [] }) {
  return JSON.stringify({
    states: states.map(({ id, name, kind }) => ({ id, name, kind })),
    transitions: transitions.map(({ id, from, to, label, role }) => ({ id, from, to, label, role })),
    known: known.map(({ title, change }) => ({ title, change: change ?? null })),
  });
}

/** Esquema JSON que Gemini debe respetar (structured output); zod vuelve a validar cada sugerencia. */
export const RESPONSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    suggestions: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["relation", "role", "inconsistency"] },
          title: { type: "string" },
          reason: { type: "string" },
          confidence: { type: "string", enum: ["alta", "media", "baja"] },
          target: {
            type: "object",
            properties: { type: { type: "string", enum: ["state", "transition"] }, id: { type: "string" } },
            required: ["type", "id"],
          },
          change: {
            type: "object",
            properties: {
              op: { type: "string", enum: ["add-transition", "set-transition-role"] },
              from: { type: "string" },
              to: { type: "string" },
              label: { type: "string" },
              role: { type: "string", enum: WORKFLOW_ROLES },
              transitionId: { type: "string" },
            },
            required: ["op", "role"],
          },
        },
        required: ["kind", "title", "reason", "confidence"],
      },
    },
  },
  required: ["suggestions"],
};
