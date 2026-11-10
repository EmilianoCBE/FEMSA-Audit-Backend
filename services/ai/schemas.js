// US15-US17 - Emiliano Carrizales: forma de las sugerencias del asistente de diseño.
// Todo lo que devuelve un proveedor de IA pasa por aquí; lo que no cumple se descarta (la IA solo propone).
import { z } from "zod";

export const FIELD_TYPES = ["short-text", "long-text", "catalog", "calculated", "date", "number", "section"];
export const SECTIONS = ["identificacion", "evaluacion", "remediacion"];

const text = (max) => z.string().trim().min(1).max(max);

/** Operaciones que el front sabe aplicar al Designer. Cualquier otra se descarta. */
export const changeSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("change-field-type"), fieldId: text(100), type: z.enum(FIELD_TYPES) }),
  z.object({ op: z.literal("rename-field"), fieldId: text(100), label: text(120) }),
  z.object({ op: z.literal("set-required"), fieldId: text(100), required: z.boolean() }),
  z.object({ op: z.literal("set-formula"), fieldId: text(100), formula: text(300) }),
  z.object({
    op: z.literal("add-field"),
    type: z.enum(FIELD_TYPES),
    label: text(120),
    section: z.enum(SECTIONS).optional(),
  }),
]);

export const suggestionSchema = z.object({
  kind: z.enum(["inconsistency", "component", "field"]),
  title: text(160),
  // RNF-12: toda sugerencia explica por qué.
  reason: text(600),
  confidence: z.enum(["alta", "media", "baja"]),
  fieldId: text(100).optional(),
  change: changeSchema.optional(),
});

/** Respuesta esperada de un proveedor de IA. */
export const providerResponseSchema = z.object({ suggestions: z.array(z.unknown()).max(20) });

/* ---------- Workflow (US15 RF-17/RF-18) ---------- */

/** Roles que pueden ejecutar una transición; deben coincidir con WORKFLOW_ROLES del front. */
export const WORKFLOW_ROLES = ["Auditor", "Jefe de Auditoría", "Dirección de Auditoría", "Responsable del área"];

const id = text(60);

/** Lo único que llega del front y sale hacia la IA: estructura del flujo (RNF-13). */
export const workflowInputSchema = z.object({
  /** Fase 3: formulario al que pertenece el flujo, para registrar las sugerencias y sus decisiones. */
  appId: text(100).optional(),
  states: z
    .array(z.object({ id, name: text(80), kind: text(30) }))
    .min(1)
    .max(30),
  transitions: z
    .array(z.object({ id, from: id, to: id, label: text(60), role: z.string().trim().max(60).nullable() }))
    .max(60),
  /** Revisiones de las reglas que el usuario ya está viendo, para que la IA no las repita. */
  known: z
    .array(
      z.object({
        title: text(160),
        change: z.record(z.string(), z.unknown()).nullable().optional(),
      }),
    )
    .max(30)
    .default([]),
});

/** Operaciones que el front sabe aplicar al flujo (applyWorkflowChange). */
export const workflowChangeSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set-transition-role"), transitionId: id, role: z.enum(WORKFLOW_ROLES) }),
  z.object({
    op: z.literal("add-transition"),
    from: id,
    to: id,
    label: text(60),
    role: z.enum(WORKFLOW_ROLES),
  }),
]);

/** Requisitos que se pueden exigir en una transición (los mismos que guarda el flujo). */
export const WORKFLOW_REQUIREMENTS = ["evidence", "comment", "actionPlan"];

/**
 * Cambios que las reglas del front (US16) pueden proponer y el usuario aplicar o reemplazar. Incluye los de la IA
 * más quitar una transición repetida y exigir un requisito.
 */
export const workflowAppliedChangeSchema = z.discriminatedUnion("op", [
  ...workflowChangeSchema.options,
  z.object({ op: z.literal("remove-transition"), transitionId: id }),
  z.object({
    op: z.literal("set-transition-requirement"),
    transitionId: id,
    requirement: z.enum(WORKFLOW_REQUIREMENTS),
    value: z.boolean(),
  }),
]);

const workflowTarget = z.object({ type: z.enum(["state", "transition"]), id });

/** Fase 3: sugerencia de las reglas del flujo que el usuario decidió (se guarda ya decidida). */
export const workflowRuleDecisionSchema = z.object({
  appId: text(100),
  suggestion: z.object({
    rule: text(40),
    title: text(160),
    reason: text(600),
    target: workflowTarget.nullable().optional(),
    change: workflowAppliedChangeSchema.optional(),
  }),
  decision: z.enum(["accepted", "rejected", "replaced"]),
  change: workflowAppliedChangeSchema.optional(),
});

/* ---------- Generar un flujo desde una descripción (RF-17) ---------- */

/** Tipos de estado que entiende el editor del flujo. */
export const WORKFLOW_STATE_KINDS = ["Inicial", "En proceso", "Aprobación", "Retorno", "Final"];

export const generateWorkflowInputSchema = z.object({
  description: z.string().trim().min(15).max(1000),
});

/** Lo que debe regresar el proveedor al generar un flujo; las reglas de estructura se revisan aparte. */
export const generatedWorkflowSchema = z.object({
  summary: text(300),
  states: z
    .array(
      z.object({
        id: z
          .string()
          .trim()
          .regex(/^[a-z0-9-]{1,40}$/),
        name: text(60),
        kind: z.enum(WORKFLOW_STATE_KINDS),
      }),
    )
    .min(3)
    .max(15),
  transitions: z
    .array(
      z.object({
        from: id,
        to: id,
        label: text(40),
        role: z.enum(WORKFLOW_ROLES),
      }),
    )
    .min(2)
    .max(30),
});

export const workflowSuggestionSchema = z.object({
  /** relation = transición nueva, role = rol para una transición, inconsistency = observación sin cambio. */
  kind: z.enum(["relation", "role", "inconsistency"]),
  title: text(160),
  reason: text(600),
  confidence: z.enum(["alta", "media", "baja"]),
  target: workflowTarget.optional(),
  change: workflowChangeSchema.optional(),
});
