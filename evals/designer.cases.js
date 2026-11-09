// US15 - Emiliano Carrizales: conjunto de evaluación del asistente del Designer (PLAN-IA §7).
// Formularios SINTÉTICOS inspirados en el ciclo de hallazgos: no contienen datos de FEMSA, personas ni montos.
// Cada caso dice qué esperamos que proponga la IA:
//   - missing: elementos de un hallazgo completo que faltan (la IA debería proponer agregarlos con add-field).
//   - components: campos de texto que deberían cambiar de componente (change-field-type).
// Las reglas (US16) corren antes y se le pasan a la IA como "known"; aquí solo se mide lo que agrega la IA.

const f = (id, type, label, section, extra = {}) => ({
  id,
  type,
  label,
  required: false,
  section,
  formula: null,
  ...extra,
});

/** Los 8 elementos que el prompt pide revisar, con las palabras con que se reconocen en una etiqueta. */
export const ELEMENTS = {
  detection: { name: "Fecha de detección", pattern: /fecha.*(detecci|identificaci|hallazgo)|detectad/ },
  area: { name: "Área o unidad auditada", pattern: /\b(area|unidad|departamento|proceso)\b/ },
  criteria: { name: "Criterio incumplido", pattern: /criterio|norma|politica|control/ },
  cause: { name: "Causa", pattern: /causa/ },
  risk: { name: "Riesgo o severidad", pattern: /riesgo|severidad|impacto|criticidad/ },
  recommendation: { name: "Recomendación", pattern: /recomendaci/ },
  owner: { name: "Responsable", pattern: /responsable/ },
  commitment: { name: "Fecha compromiso", pattern: /fecha.*(compromiso|limite|atencion)|compromiso|vencimiento/ },
};

const complete = () => [
  f("titulo", "short-text", "Título del hallazgo", "identificacion", { required: true }),
  f("detectado", "date", "Fecha de detección", "identificacion", { required: true }),
  f("area", "catalog", "Área auditada", "identificacion", { required: true }),
  f("criterio", "long-text", "Criterio incumplido", "evaluacion"),
  f("causa", "long-text", "Causa raíz", "evaluacion"),
  f("severidad", "catalog", "Severidad", "evaluacion", { required: true }),
  f("recomendacion", "long-text", "Recomendación", "remediacion"),
  f("responsable", "catalog", "Responsable del plan", "remediacion", { required: true }),
  f("compromiso", "date", "Fecha compromiso", "remediacion", { required: true }),
];

const without = (...ids) => complete().filter((field) => !ids.includes(field.id));

export const DESIGNER_CASES = [
  {
    id: "completo",
    description: "Formulario con los 8 elementos: no debería proponer agregar nada.",
    fields: complete(),
    missing: [],
    components: [],
  },
  {
    id: "sin-responsable",
    description: "Falta quién atiende el plan de acción.",
    fields: without("responsable"),
    missing: ["owner"],
    components: [],
  },
  {
    id: "sin-remediacion",
    description: "No tiene recomendación, responsable ni fecha compromiso.",
    fields: without("recomendacion", "responsable", "compromiso"),
    missing: ["recommendation", "owner", "commitment"],
    components: [],
  },
  {
    id: "sin-causa-criterio",
    description: "La evaluación no dice qué se incumplió ni por qué.",
    fields: without("criterio", "causa"),
    missing: ["criteria", "cause"],
    components: [],
  },
  {
    id: "sin-fechas",
    description: "Sin fecha de detección ni fecha compromiso.",
    fields: without("detectado", "compromiso"),
    missing: ["detection", "commitment"],
    components: [],
  },
  {
    id: "minimo",
    description: "Solo título y descripción: le faltan casi todos los elementos.",
    fields: [
      f("titulo", "short-text", "Título del hallazgo", "identificacion", { required: true }),
      f("desc", "long-text", "Descripción de la condición", "evaluacion"),
    ],
    missing: ["detection", "area", "criteria", "cause", "risk", "recommendation", "owner", "commitment"],
    components: [],
  },
  {
    id: "fecha-como-texto",
    description: "La fecha compromiso está como texto corto.",
    fields: complete().map((field) => (field.id === "compromiso" ? { ...field, type: "short-text" } : field)),
    missing: [],
    components: [{ fieldId: "compromiso", type: "date" }],
  },
  {
    id: "monto-como-texto",
    description: "Un monto de impacto capturado como texto.",
    fields: [...complete(), f("monto", "short-text", "Monto del impacto económico", "evaluacion")],
    missing: [],
    components: [{ fieldId: "monto", type: "number" }],
  },
  {
    id: "sin-riesgo",
    description: "No hay forma de priorizar el hallazgo.",
    fields: without("severidad"),
    missing: ["risk"],
    components: [],
  },
  {
    id: "sin-area",
    description: "No dice qué área se auditó.",
    fields: without("area"),
    missing: ["area"],
    components: [],
  },
  {
    id: "etiquetas-por-defecto",
    description: "Campos recién arrastrados que nadie renombró (las reglas ya los señalan).",
    fields: [
      f("titulo", "short-text", "Título del hallazgo", "identificacion", { required: true }),
      f("c1", "short-text", "Texto corto", "identificacion"),
      f("c2", "date", "Fecha", "evaluacion"),
      f("c3", "catalog", "Lista de opciones", "remediacion"),
    ],
    missing: ["area", "criteria", "cause", "risk", "recommendation", "owner"],
    components: [],
  },
  {
    id: "calculado-sin-formula",
    description: "Riesgo residual calculado sin fórmula y sin recomendación.",
    fields: [...without("recomendacion"), f("residual", "calculated", "Riesgo residual", "evaluacion")],
    missing: ["recommendation"],
    components: [],
  },
];
