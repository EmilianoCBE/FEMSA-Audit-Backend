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
