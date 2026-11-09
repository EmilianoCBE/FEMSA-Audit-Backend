// Proveedor simulado: responde como lo haría el modelo, sin llamadas externas ni costo.
// Se usa en desarrollo sin llave, en las pruebas y en el CI (AI_PROVIDER=mock).

const hasType = (fields, type) => fields.some((field) => field.type === type);
const hasLabel = (fields, pattern) => fields.some((field) => pattern.test(String(field.label ?? "").toLowerCase()));

export const mockProvider = {
  name: "mock",
  promptVersion: "mock-v1",

  async suggestDesigner({ fields }) {
    const suggestions = [];

    if (!hasType(fields, "date") && !hasLabel(fields, /fecha/)) {
      suggestions.push({
        kind: "field",
        title: "Agregar la fecha de detección del hallazgo",
        reason:
          "Los hallazgos de auditoría se reportan y priorizan por antigüedad; sin una fecha de detección no se " +
          "puede medir el tiempo de atención ni filtrar por periodo.",
        confidence: "media",
        change: { op: "add-field", type: "date", label: "Fecha de detección", section: "identificacion" },
      });
    }

    if (!hasLabel(fields, /responsable/)) {
      suggestions.push({
        kind: "field",
        title: "Agregar el responsable de la remediación",
        reason:
          "Cada hallazgo necesita a una persona que atienda el plan de acción; sin este campo no se puede dar " +
          "seguimiento ni enviar notificaciones.",
        confidence: "media",
        change: { op: "add-field", type: "short-text", label: "Responsable de la remediación", section: "remediacion" },
      });
    }

    return { suggestions };
  },
};
