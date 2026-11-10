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

  generatePromptVersion: "mock-workflow-generate-v1",

  /**
   * RF-17 (determinista para pruebas y demo): arma el ciclo del hallazgo y agrega pasos según palabras de la
   * descripción (respuesta del área, dirección, remediación, aceptación de riesgo).
   */
  async generateWorkflow({ description }) {
    const has = (pattern) => pattern.test(description.toLowerCase());
    const withArea = has(/respuesta|responsable|área|area|auditad/);
    const withDirector = has(/direcci[oó]n|director/);
    const withRemediation = has(/plan de acci[oó]n|remedia|seguimiento/);
    const withRiskAcceptance = has(/riesgo/);

    const states = [
      { id: "borrador", name: "Borrador", kind: "Inicial" },
      { id: "revision", name: "Revisión del jefe", kind: "Aprobación" },
      { id: "devuelto", name: "Devuelto", kind: "Retorno" },
    ];
    const transitions = [
      { from: "borrador", to: "revision", label: "enviar a revisión", role: "Auditor" },
      { from: "revision", to: "devuelto", label: "devolver", role: "Jefe de Auditoría" },
      { from: "devuelto", to: "revision", label: "corregir y reenviar", role: "Auditor" },
    ];
    let last = "revision";
    const step = (state, label, role) => {
      states.push(state);
      transitions.push({ from: last, to: state.id, label, role });
      last = state.id;
    };
    if (withArea)
      step({ id: "respuesta-area", name: "Respuesta del área", kind: "En proceso" }, "comunicar", "Jefe de Auditoría");
    if (withDirector) {
      step(
        { id: "aprobacion-direccion", name: "Aprobación de dirección", kind: "Aprobación" },
        "enviar a dirección",
        withArea ? "Responsable del área" : "Jefe de Auditoría",
      );
      transitions.push({
        from: "aprobacion-direccion",
        to: "devuelto",
        label: "rechazar",
        role: "Dirección de Auditoría",
      });
    }
    const approver = withDirector ? "Dirección de Auditoría" : "Jefe de Auditoría";
    if (withRemediation) {
      step({ id: "remediacion", name: "En remediación", kind: "En proceso" }, "aprobar", approver);
      step(
        { id: "validacion-remediacion", name: "Validación de la remediación", kind: "Aprobación" },
        "entregar evidencia",
        "Responsable del área",
      );
      transitions.push({
        from: "validacion-remediacion",
        to: "remediacion",
        label: "evidencia insuficiente",
        role: "Jefe de Auditoría",
      });
      step({ id: "cerrado", name: "Cerrado", kind: "Final" }, "cerrar", "Jefe de Auditoría");
    } else {
      step({ id: "cerrado", name: "Cerrado", kind: "Final" }, "aprobar y cerrar", approver);
    }
    if (withRiskAcceptance) {
      const from = withRemediation ? "remediacion" : withArea ? "respuesta-area" : "revision";
      states.push({ id: "riesgo-aceptado", name: "Riesgo aceptado", kind: "Final" });
      transitions.push({ from, to: "riesgo-aceptado", label: "aceptar el riesgo", role: "Dirección de Auditoría" });
    }

    return {
      summary:
        "Flujo propuesto a partir de tu descripción: el auditor documenta, el jefe revisa y puede devolver" +
        (withRemediation ? "; después se da seguimiento al plan de acción hasta validar la evidencia." : "."),
      states,
      transitions,
    };
  },
};
