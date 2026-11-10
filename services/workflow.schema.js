// Fase 1 del workflow - Emiliano Carrizales: forma del flujo del proceso que se guarda con cada formulario.
// El flujo vive junto al lienzo del Designer y entra en AppVersions.config.workflow al guardar una versión (US11),
// así que se versiona, compara y restaura con el formulario. Solo se acepta esta forma; lo demás se rechaza.
import { z } from "zod";

const id = z.string().trim().min(1).max(60);
const text = (max) => z.string().trim().min(1).max(max);
const point = z.object({ x: z.number().finite(), y: z.number().finite() });

const state = z.object({
  id,
  kind: text(30),
  name: text(80),
  tone: z.enum(["neutral", "amber", "accent", "green", "red"]),
  position: point,
  /** Fase 2: días que un hallazgo puede quedarse en este estado antes de considerarse vencido. */
  slaDays: z.number().int().min(1).max(365).optional(),
});

/** Fase 2: lo que se exige para ejecutar una transición (lo aplicará el flujo en operación). */
const requires = z
  .object({ evidence: z.boolean().optional(), comment: z.boolean().optional(), actionPlan: z.boolean().optional() })
  .optional();

const transition = z.object({
  id,
  label: text(60),
  from: id,
  to: id,
  role: z.string().trim().max(60).nullable(),
  /** Trazo SVG dentro del lienzo; si falta, el front lo calcula entre los dos estados. */
  path: z.string().max(2000).optional(),
  labelPosition: point.optional(),
  labelAnchor: z.enum(["start", "middle", "end"]).optional(),
  variant: z.enum(["default", "active", "rejected", "suggested"]),
  requires,
});

export const workflowSchema = z
  .object({
    size: z.object({ width: z.number().positive().max(10_000), height: z.number().positive().max(10_000) }),
    states: z.array(state).min(1).max(40),
    transitions: z.array(transition).max(80),
    suggestedStates: z
      .array(z.object({ id, kind: text(30), name: text(80), position: point }))
      .max(20)
      .default([]),
    annotations: z
      .array(z.object({ id, label: text(80), position: point }))
      .max(20)
      .default([]),
  })
  .superRefine((workflow, context) => {
    const stateIds = workflow.states.map((item) => item.id);
    const allIds = new Set([...stateIds, ...workflow.suggestedStates.map((item) => item.id)]);
    if (new Set(stateIds).size !== stateIds.length) {
      context.addIssue({ code: "custom", message: "Hay estados con el mismo id." });
    }
    const transitionIds = workflow.transitions.map((item) => item.id);
    if (new Set(transitionIds).size !== transitionIds.length) {
      context.addIssue({ code: "custom", message: "Hay transiciones con el mismo id." });
    }
    for (const item of workflow.transitions) {
      if (!allIds.has(item.from) || !allIds.has(item.to)) {
        context.addIssue({
          code: "custom",
          message: `La transición «${item.label}» apunta a un estado que no existe.`,
        });
      }
    }
  });

/** Devuelve el flujo normalizado o lanza el primer error de validación como texto. */
export function parseWorkflow(value) {
  const result = workflowSchema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue.path.length ? ` (${issue.path.join(".")})` : "";
    throw Object.assign(new Error(`El flujo no es válido: ${issue.message}${where}`), { status: 400 });
  }
  return result.data;
}
