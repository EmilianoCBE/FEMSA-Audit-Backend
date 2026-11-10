// Fase 4 del workflow - Emiliano Carrizales: el flujo en operación. Un proceso (un hallazgo) se inicia con la versión
// publicada del formulario, queda anclado a ella y termina con ese flujo aunque después se publique otra versión.
// Cada movimiento valida que la transición salga del estado actual, el rol del usuario, la segregación de funciones
// y los requisitos (comentario, evidencia, plan de acción). Ver WORKFLOW-PROCESOS.md en la carpeta del proyecto.
import { z } from "zod";
import { versionsRepository } from "../repositories/versions.repository.js";
import { workflowInstancesRepository } from "../repositories/workflowInstances.repository.js";
import { badRequest, HttpError, notFoundError } from "../utils/httpErrors.js";
import { isAdmin } from "../utils/permissions.js";
import { validateAppId } from "./versions.service.js";

export const WORKFLOW_ROLES = ["Auditor", "Jefe de Auditoría", "Dirección de Auditoría", "Responsable del área"];

/**
 * Roles de la aplicación (dbo.ROLE) → roles del flujo. Los que configuran (Creador de aplicaciones, Visualizador,
 * Administrador funcional) y la segunda línea (Revisor de Control Interno) no ejecutan pasos por ahora.
 * El Administrador (2) puede actuar con cualquier rol para administrar y para la demo.
 */
const WORKFLOW_ROLES_BY_APP_ROLE = {
  2: WORKFLOW_ROLES,
  5: ["Auditor"],
  6: ["Auditor"],
  7: ["Auditor"],
  8: ["Jefe de Auditoría"],
  9: ["Jefe de Auditoría"],
  10: ["Dirección de Auditoría"],
  12: ["Responsable del área"],
};

export const workflowRolesFor = (user) =>
  isAdmin(user) ? WORKFLOW_ROLES : (WORKFLOW_ROLES_BY_APP_ROLE[Number(user?.roleId)] ?? []);

const MISSING_TABLE_MESSAGE = "Faltan las tablas de procesos del workflow: ejecuta npm run workflow:migrate.";
const isMissingTable = (error) => error?.number === 208 || /Invalid object name/i.test(error?.message ?? "");

async function withTables(run) {
  try {
    return await run();
  } catch (error) {
    if (isMissingTable(error)) throw new HttpError(503, MISSING_TABLE_MESSAGE);
    throw error;
  }
}

/* ---------- El flujo de una versión (no cambia nunca: se puede guardar en memoria) ---------- */

const workflowByVersion = new Map();

async function pinnedWorkflow(appId, appVersionId) {
  if (workflowByVersion.has(appVersionId)) return workflowByVersion.get(appVersionId);
  const version = await versionsRepository.findById(appId, appVersionId);
  const workflow = version?.config?.workflow ?? null;
  if (workflow) workflowByVersion.set(appVersionId, workflow);
  return workflow;
}

/** Para las pruebas: olvida los flujos guardados en memoria. */
export const clearWorkflowCache = () => workflowByVersion.clear();

/* ---------- Reglas puras ---------- */

const realTransitions = (workflow) => {
  const ids = new Set(workflow.states.map((state) => state.id));
  return workflow.transitions.filter(
    (transition) => transition.variant !== "suggested" && ids.has(transition.from) && ids.has(transition.to),
  );
};

/** Paso del proceso de cada estado: distancia más corta desde el inicial (igual que el asistente del front). */
function stepsFromInitial(workflow) {
  const transitions = realTransitions(workflow);
  const initial = workflow.states.find((state) => state.kind === "Inicial");
  const steps = new Map(initial ? [[initial.id, 0]] : []);
  const queue = initial ? [initial.id] : [];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const transition of transitions) {
      if (transition.from === current && !steps.has(transition.to)) {
        steps.set(transition.to, steps.get(current) + 1);
        queue.push(transition.to);
      }
    }
  }
  return steps;
}

/** Aprobar o cerrar: llegar a un final o avanzar desde una aprobación (devolver a un paso anterior no cuenta). */
export function isApproval(workflow, transition) {
  const from = workflow.states.find((state) => state.id === transition.from);
  const to = workflow.states.find((state) => state.id === transition.to);
  if (to?.kind === "Final") return true;
  if (from?.kind !== "Aprobación" || to?.kind === "Retorno") return false;
  const steps = stepsFromInitial(workflow);
  return !(steps.get(to?.id) < steps.get(from.id));
}

/**
 * Lo que el usuario puede hacer en el estado actual del proceso: cada transición que sale de ahí, si la puede
 * ejecutar y, si no, por qué (rol o segregación de funciones).
 */
export function availableActions(workflow, instance, user) {
  if (instance.status !== "active") return [];
  const roles = workflowRolesFor(user);
  const stateName = (id) => workflow.states.find((state) => state.id === id)?.name ?? id;
  return realTransitions(workflow)
    .filter((transition) => transition.from === instance.currentStateId)
    .map((transition) => {
      let reason = null;
      if (!transition.role) reason = "Esta transición no tiene rol asignado en el flujo.";
      else if (!roles.includes(transition.role)) reason = `La ejecuta ${transition.role}.`;
      else if (instance.startedById === user?.id && isApproval(workflow, transition)) {
        reason = "Segregación de funciones: no puedes aprobar ni cerrar un proceso que tú iniciaste.";
      }
      return {
        transitionId: transition.id,
        label: transition.label,
        toStateId: transition.to,
        toStateName: stateName(transition.to),
        role: transition.role,
        requires: transition.requires ?? {},
        allowed: reason === null,
        reason,
      };
    });
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Días en el estado actual y si ya pasó el plazo del estado (`slaDays`). */
export function stateTiming(workflow, instance, now = new Date()) {
  const state = workflow.states.find((item) => item.id === instance.currentStateId);
  const days = Math.floor((now - new Date(instance.stateEnteredAt)) / DAY_MS);
  const slaDays = instance.status === "active" ? (state?.slaDays ?? null) : null;
  return { daysInState: Math.max(0, days), slaDays, overdue: slaDays !== null && days > slaDays };
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha con formato AAAA-MM-DD.");

const transitionBodySchema = z.object({
  transitionId: z.string().trim().min(1).max(60),
  comment: z.string().trim().max(1000).optional(),
  evidence: z.string().trim().max(500).optional(),
  actionPlan: z
    .object({
      description: z.string().trim().min(1).max(500),
      owner: z.string().trim().min(1).max(150),
      dueDate: isoDate,
    })
    .optional(),
});

/** Revisa lo que exige la transición; regresa el primer faltante como texto o `null`. */
export function missingRequirement(requires = {}, { comment, evidence, actionPlan }, today = new Date()) {
  if (requires.comment && !comment) return "Esta transición exige un comentario.";
  if (requires.evidence && !evidence) return "Esta transición exige evidencia (enlace o descripción del documento).";
  if (requires.actionPlan) {
    if (!actionPlan) return "Esta transición exige un plan de acción (descripción, responsable y fecha compromiso).";
    if (actionPlan.dueDate < today.toISOString().slice(0, 10))
      return "La fecha compromiso no puede estar en el pasado.";
  }
  return null;
}

/* ---------- Respuestas ---------- */

function toPublicInstance(instance, workflow, now) {
  const state = workflow?.states.find((item) => item.id === instance.currentStateId);
  return {
    id: instance.id,
    appId: instance.appId,
    title: instance.title,
    status: instance.status,
    version: {
      id: instance.appVersionId,
      number: instance.versionNumber,
      // false: el proceso sigue con una versión anterior a la vigente (así debe ser hasta que termine).
      isCurrent: instance.versionStatus === "current",
    },
    currentState: {
      id: instance.currentStateId,
      name: state?.name ?? instance.currentStateId,
      kind: state?.kind ?? null,
    },
    ...(workflow ? stateTiming(workflow, instance, now) : { daysInState: 0, slaDays: null, overdue: false }),
    startedBy: instance.startedByName,
    startedAt: instance.startedAt,
    completedAt: instance.completedAt,
  };
}

/* ---------- Casos de uso ---------- */

const startSchema = z.object({ appId: z.string().trim().min(1).max(100), title: z.string().trim().min(3).max(200) });

/** La versión vigente (publicada) del formulario con su flujo, o un 409 que explica qué falta. */
async function currentVersionWithWorkflow(appId) {
  const versions = await versionsRepository.list(appId);
  const current = versions.find((version) => version.status === "current");
  if (!current) throw new HttpError(409, "El formulario no tiene una versión publicada. Publica una versión primero.");
  const workflow = await pinnedWorkflow(appId, current.id);
  if (!workflow) {
    throw new HttpError(
      409,
      `La versión publicada (v${current.number}) no tiene flujo. Guarda el flujo, crea una versión y publícala.`,
    );
  }
  return { version: current, workflow };
}

export async function startInstance(body, user) {
  const parsed = startSchema.safeParse(body);
  if (!parsed.success) throw badRequest("Indica el formulario y un título de 3 a 200 caracteres.");
  const appId = validateAppId(parsed.data.appId);
  if (!workflowRolesFor(user).includes("Auditor")) {
    throw new HttpError(403, "Solo un rol de auditoría puede iniciar un proceso.");
  }
  const { version, workflow } = await currentVersionWithWorkflow(appId);
  const initial = workflow.states.find((state) => state.kind === "Inicial");
  if (!initial) throw new HttpError(409, `El flujo de v${version.number} no tiene estado inicial.`);

  const instance = await withTables(() =>
    workflowInstancesRepository.create({
      appId,
      appVersionId: version.id,
      title: parsed.data.title,
      initialStateId: initial.id,
      actor: { id: user.id, name: user.name, workflowRole: "Auditor" },
    }),
  );
  return toPublicInstance(instance, workflow);
}

export async function listInstances(appIdInput, status) {
  const appId = validateAppId(appIdInput);
  if (status && !["active", "completed"].includes(status)) throw badRequest("status debe ser active o completed.");
  const instances = await withTables(() => workflowInstancesRepository.list(appId, status));
  const now = new Date();
  return Promise.all(
    instances.map(async (instance) =>
      toPublicInstance(instance, await pinnedWorkflow(instance.appId, instance.appVersionId), now),
    ),
  );
}

async function findInstance(id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) throw notFoundError("No existe ese proceso.");
  const instance = await withTables(() => workflowInstancesRepository.findById(id));
  if (!instance) throw notFoundError("No existe ese proceso.");
  return instance;
}

export async function getInstance(id, user) {
  const instance = await findInstance(id);
  const workflow = await pinnedWorkflow(instance.appId, instance.appVersionId);
  const history = await workflowInstancesRepository.history(instance.id);
  const stateName = (stateId) => workflow?.states.find((state) => state.id === stateId)?.name ?? stateId;
  return {
    ...toPublicInstance(instance, workflow),
    // El flujo con el que corre este proceso (el de su versión, no el vigente).
    workflow,
    myRoles: workflowRolesFor(user),
    actions: workflow ? availableActions(workflow, instance, user) : [],
    history: history.map((entry) => ({
      ...entry,
      fromStateName: entry.fromStateId ? stateName(entry.fromStateId) : null,
      toStateName: stateName(entry.toStateId),
    })),
  };
}

export async function executeTransition(id, body, user) {
  const parsed = transitionBodySchema.safeParse(body);
  if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? "Datos de la transición no válidos.");
  const instance = await findInstance(id);
  if (instance.status !== "active") throw new HttpError(409, "Este proceso ya terminó.");

  const workflow = await pinnedWorkflow(instance.appId, instance.appVersionId);
  if (!workflow) throw new HttpError(409, "No se encontró el flujo de la versión de este proceso.");
  const transition = realTransitions(workflow).find((item) => item.id === parsed.data.transitionId);
  // Una transición que no existe en la versión del proceso (aunque exista en la vigente) no se puede ejecutar.
  if (!transition) {
    throw new HttpError(409, `La transición no existe en el flujo de v${instance.versionNumber} de este proceso.`);
  }
  if (transition.from !== instance.currentStateId) {
    throw new HttpError(409, "El proceso ya no está en el estado de esa transición. Actualiza la pantalla.");
  }

  const action = availableActions(workflow, instance, user).find((item) => item.transitionId === transition.id);
  if (!action?.allowed) throw new HttpError(403, action?.reason ?? "No puedes ejecutar esta transición.");

  const missing = missingRequirement(transition.requires, parsed.data);
  if (missing) throw badRequest(missing);

  const to = workflow.states.find((state) => state.id === transition.to);
  const roles = workflowRolesFor(user);
  const moved = await workflowInstancesRepository.transition(instance.id, {
    transitionId: transition.id,
    action: transition.label,
    fromStateId: transition.from,
    toStateId: transition.to,
    completes: to?.kind === "Final",
    actor: { id: user.id, name: user.name, workflowRole: roles.includes(transition.role) ? transition.role : null },
    comment: parsed.data.comment || null,
    evidence: parsed.data.evidence || null,
    actionPlan: parsed.data.actionPlan ?? null,
  });
  if (!moved) throw new HttpError(409, "Otra persona movió este proceso al mismo tiempo. Actualiza la pantalla.");
  return getInstance(instance.id, user);
}

/** Para avisar al publicar: cuántos procesos siguen en curso con cada versión. */
export async function instancesSummary(appIdInput) {
  const appId = validateAppId(appIdInput);
  try {
    return { appId, activeByVersion: await workflowInstancesRepository.activeByVersion(appId) };
  } catch (error) {
    // Sin las tablas no hay procesos: el aviso simplemente no aparece.
    if (isMissingTable(error)) return { appId, activeByVersion: [] };
    throw error;
  }
}
