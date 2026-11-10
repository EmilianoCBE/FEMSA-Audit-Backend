// US16 - Emiliano Carrizales: inconsistencias del Designer detectadas con reglas (sin IA).
// Cada regla es una función pura (fields) => sugerencias. Siempre responden, aunque la IA no esté disponible (US18).

/** Nombres con los que la paleta del Designer crea los campos: si la etiqueta sigue igual, nadie la renombró. */
const GENERIC_LABELS = new Set(
  [
    "texto corto",
    "texto largo",
    "lista de opciones",
    "catalogo",
    "fecha",
    "numerico",
    "numero",
    "adjunto",
    "usuario / rol",
    "referencia",
    "campo calculado",
    "calculado",
    "campo",
    "nuevo campo",
  ].map(normalize),
);

/** Palabras en la etiqueta que indican un componente más adecuado que texto. */
const COMPONENT_HINTS = [
  { pattern: /\bfecha\b|\bvencimiento\b|\bplazo\b/, type: "date", component: "Fecha" },
  {
    pattern: /\bmonto\b|\bimporte\b|\bcantidad\b|\btotal\b|\bporcentaje\b|\bcosto\b/,
    type: "number",
    component: "Numérico",
  },
  {
    pattern: /\bdescripcion\b|\bobservacion(es)?\b|\bcomentario(s)?\b|\bdetalle\b|\bjustificacion\b/,
    type: "long-text",
    component: "Texto largo",
  },
];

const TEXT_TYPES = new Set(["short-text", "long-text"]);

/** Las tres secciones fijas del formulario de hallazgo, en el orden en que el Designer las muestra. */
const SECTION_NAMES = {
  identificacion: "Identificación",
  evaluacion: "Evaluación",
  remediacion: "Remediación",
};

export function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

const display = (field) => field.label?.trim() || field.id;

export function genericLabelRule(fields) {
  return fields
    .filter((field) => !field.label?.trim() || GENERIC_LABELS.has(normalize(field.label)))
    .map((field) => ({
      kind: "inconsistency",
      title: field.label?.trim()
        ? `El campo «${field.label.trim()}» no tiene un nombre descriptivo`
        : `El campo ${field.id} no tiene etiqueta`,
      reason:
        "La etiqueta es la que viene por defecto al arrastrar el componente. Quien capture el hallazgo no sabrá qué " +
        "información poner y en los reportes la columna no se podrá identificar.",
      confidence: "alta",
      fieldId: field.id,
    }));
}

export function duplicateLabelRule(fields) {
  const seen = new Map();
  const suggestions = [];
  for (const field of fields) {
    const key = normalize(field.label);
    if (!key) continue;
    if (seen.has(key)) {
      suggestions.push({
        kind: "inconsistency",
        title: `Hay dos campos llamados «${field.label.trim()}»`,
        reason:
          `Este campo tiene la misma etiqueta que ${seen.get(key)}. En la captura y en los reportes no se podrán ` +
          "distinguir; renombra uno o elimina el duplicado.",
        confidence: "alta",
        fieldId: field.id,
      });
    } else {
      seen.set(key, field.id);
    }
  }
  return suggestions;
}

export function calculatedWithoutFormulaRule(fields) {
  return fields
    .filter((field) => field.type === "calculated" && !field.formula?.trim())
    .map((field) => ({
      kind: "inconsistency",
      title: `«${display(field)}» es calculado pero no tiene fórmula`,
      reason:
        "Un campo calculado sin fórmula siempre queda vacío: nadie lo puede capturar y el sistema no sabe cómo obtenerlo.",
      confidence: "alta",
      fieldId: field.id,
    }));
}

export function componentHintRule(fields) {
  const suggestions = [];
  for (const field of fields) {
    if (!TEXT_TYPES.has(field.type) || !field.label?.trim()) continue;
    const label = normalize(field.label);
    const hint = COMPONENT_HINTS.find((candidate) => candidate.pattern.test(label) && candidate.type !== field.type);
    // Texto largo solo se sugiere sobre texto corto (un texto largo con "descripción" ya está bien).
    if (!hint || (hint.type === "long-text" && field.type !== "short-text")) continue;
    suggestions.push({
      kind: "component",
      title: `Usar el componente ${hint.component} para «${field.label.trim()}»`,
      reason:
        `La etiqueta indica que el dato es de tipo ${hint.component.toLowerCase()}. Con el componente adecuado se ` +
        "valida la captura y el dato se puede filtrar y ordenar en los reportes.",
      confidence: "media",
      fieldId: field.id,
      change: { op: "change-field-type", fieldId: field.id, type: hint.type },
    });
  }
  return suggestions;
}

/** Una sección sin campos deja al auditor sin dónde capturar esa etapa del hallazgo. Un formulario vacío no aplica. */
export function emptySectionRule(fields) {
  if (fields.length === 0) return [];
  const used = new Set(fields.map((field) => field.section));
  return Object.entries(SECTION_NAMES)
    .filter(([id]) => !used.has(id))
    .map(([id, name]) => ({
      kind: "inconsistency",
      title: `La sección ${name} no tiene campos`,
      reason:
        `El hallazgo se captura por etapas y ${name} quedaría vacía: el auditor no podrá registrar esa parte y los ` +
        "reportes mostrarán la sección sin datos. Agrega al menos un campo o mueve uno existente a esa sección.",
      confidence: "alta",
    }));
}

export const DESIGNER_RULES = [
  genericLabelRule,
  duplicateLabelRule,
  calculatedWithoutFormulaRule,
  emptySectionRule,
  componentHintRule,
];

export function runDesignerRules(fields) {
  return DESIGNER_RULES.flatMap((rule) => rule(fields));
}
