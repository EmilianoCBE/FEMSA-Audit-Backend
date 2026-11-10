// Proveedor simulado: responde como lo haría el modelo, sin llamadas externas ni costo.
// Se usa en desarrollo sin llave, en las pruebas y en el CI (AI_PROVIDER=mock).

const hasType = (fields, type) => fields.some((field) => field.type === type);
const hasLabel = (fields, pattern) => fields.some((field) => pattern.test(String(field.label ?? "").toLowerCase()));

export const mockProvider = {
  name: "mock",
  promptVersion: "mock-v1",

  async checkHealth() {},

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

  workflowPromptVersion: "mock-workflow-v1",

  /** Si una aprobación no tiene cómo regresar a revisión, propone "devolver" (determinista para pruebas y demo). */
  async suggestWorkflow({ states, transitions }) {
    const suggestions = [];
    const review = states.find((state) => state.kind === "En proceso");
    const returns = new Set(
      states.filter((state) => state.kind === "Retorno" || state.kind === "En proceso").map((s) => s.id),
    );
    for (const state of states.filter((candidate) => candidate.kind === "Aprobación")) {
      const canReturn = transitions.some((transition) => transition.from === state.id && returns.has(transition.to));
      if (review && !canReturn) {
        suggestions.push({
          kind: "relation",
          title: `Permitir devolver a revisión desde «${state.name}»`,
          reason:
            "Si quien valida encuentra un problema, hoy solo puede aprobar. Una transición para devolver el hallazgo a " +
            "revisión evita aprobar algo incompleto.",
          confidence: "media",
          target: { type: "state", id: state.id },
          change: { op: "add-transition", from: state.id, to: review.id, label: "devolver", role: "Jefe de Auditoría" },
        });
      }
    }
    return { suggestions: suggestions.slice(0, 5) };
  },
};
