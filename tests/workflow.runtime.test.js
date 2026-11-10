import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, mock, test } from "node:test";
import sql from "mssql";
import { versionsRepository } from "../repositories/versions.repository.js";
import { workflowInstancesRepository } from "../repositories/workflowInstances.repository.js";
import {
  availableActions,
  clearWorkflowCache,
  isApproval,
  missingRequirement,
  stateTiming,
  workflowRolesFor,
} from "../services/workflowRuntime.service.js";
import { SESSION_COOKIE, tokenHash } from "../utils/session.js";

// Fase 4: procesos del workflow. La BD solo se simula para la sesión; versiones y procesos viven en memoria.
const users = {
  auditor: { Id: "00000000-0000-4000-8000-0000000000a1", Name: "Ana Auditora", Role: "Auditor", RoleId: 6 },
  jefe: { Id: "00000000-0000-4000-8000-0000000000a2", Name: "Jorge Jefe", Role: "Jefe de Auditoría", RoleId: 8 },
  director: { Id: "00000000-0000-4000-8000-0000000000a3", Name: "Diana Directora", Role: "Director", RoleId: 10 },
  auditado: { Id: "00000000-0000-4000-8000-0000000000a4", Name: "Raúl Área", Role: "Personal Auditado", RoleId: 12 },
  admin: { Id: "00000000-0000-4000-8000-0000000000a5", Name: "Karla Admin", Role: "Administrador", RoleId: 2 },
  creador: { Id: "00000000-0000-4000-8000-0000000000a6", Name: "Rafa Creador", Role: "Creador", RoleId: 3 },
};
const tokens = Object.fromEntries(Object.keys(users).map((key, index) => [key, String(index + 1).repeat(64)]));
const as = (who) => ({ Cookie: `${SESSION_COOKIE}=${tokens[who]}`, "Content-Type": "application/json" });

const state = (id, kind, name = id, extra = {}) => ({
  id,
  kind,
  name,
  tone: "neutral",
  position: { x: 0, y: 0 },
  ...extra,
});
const transition = (id, from, to, role, extra = {}) => ({
  id,
  label: id,
  from,
  to,
  role,
  variant: "default",
  ...extra,
});

// v1: borrador → revisión (jefe) → cerrado, con devolver.
const workflowV1 = {
  size: { width: 600, height: 300 },
  states: [
    state("borrador", "Inicial", "Borrador"),
    state("revision", "Aprobación", "Revisión del jefe", { slaDays: 5 }),
    state("devuelto", "Retorno", "Devuelto"),
    state("cerrado", "Final", "Cerrado"),
  ],
  transitions: [
    transition("enviar", "borrador", "revision", "Auditor", { requires: { evidence: true } }),
    transition("devolver", "revision", "devuelto", "Jefe de Auditoría", { requires: { comment: true } }),
    transition("reenviar", "devuelto", "revision", "Auditor"),
    transition("cerrar", "revision", "cerrado", "Jefe de Auditoría"),
  ],
  suggestedStates: [],
  annotations: [],
};

// v2: agrega la respuesta del área antes de cerrar; «cerrar» ya no sale de revisión.
const workflowV2 = {
  ...workflowV1,
  states: [...workflowV1.states, state("respuesta", "En proceso", "Respuesta del área")],
  transitions: [
    workflowV1.transitions[0],
    workflowV1.transitions[1],
    workflowV1.transitions[2],
    transition("comunicar", "revision", "respuesta", "Jefe de Auditoría"),
    transition("responder", "respuesta", "cerrado", "Dirección de Auditoría", {
      requires: { actionPlan: true },
    }),
  ],
};

let server;
let api;
let originalConnect;
let versions;
let instances;
let historyRows;

function useInMemory() {
  versions = [{ id: 1, appId: "form", number: 1, status: "current", config: { elements: [], workflow: workflowV1 } }];
  instances = [];
  historyRows = [];
  clearWorkflowCache();
  const summary = ({ config: _config, ...rest }) => rest;
  mock.method(versionsRepository, "list", async (appId) =>
    versions.filter((version) => version.appId === appId).map(summary),
  );
  mock.method(versionsRepository, "findById", async (appId, id) =>
    structuredClone(versions.find((version) => version.appId === appId && version.id === id) ?? null),
  );
  const withVersion = (instance) => {
    const version = versions.find((item) => item.id === instance.appVersionId);
    return { ...structuredClone(instance), versionNumber: version.number, versionStatus: version.status };
  };
  mock.method(workflowInstancesRepository, "create", async ({ appId, appVersionId, title, initialStateId, actor }) => {
    const instance = {
      id: randomUUID(),
      appId,
      appVersionId,
      title,
      currentStateId: initialStateId,
      status: "active",
      stateEnteredAt: new Date(),
      startedById: actor.id,
      startedByName: actor.name,
      startedAt: new Date(),
      completedAt: null,
    };
    instances.push(instance);
    historyRows.push({
      instanceId: instance.id,
      action: "iniciar",
      fromStateId: null,
      toStateId: initialStateId,
      actorName: actor.name,
    });
    return withVersion(instance);
  });
  mock.method(workflowInstancesRepository, "list", async (appId, status) =>
    instances.filter((item) => item.appId === appId && (!status || item.status === status)).map(withVersion),
  );
  mock.method(workflowInstancesRepository, "findById", async (id) => {
    const instance = instances.find((item) => item.id === id);
    return instance ? withVersion(instance) : null;
  });
  mock.method(workflowInstancesRepository, "history", async (id) =>
    historyRows.filter((row) => row.instanceId === id).map((row) => structuredClone(row)),
  );
  mock.method(workflowInstancesRepository, "transition", async (id, change) => {
    const instance = instances.find((item) => item.id === id);
    if (!instance || instance.status !== "active" || instance.currentStateId !== change.fromStateId) return null;
    Object.assign(instance, {
      currentStateId: change.toStateId,
      stateEnteredAt: new Date(),
      status: change.completes ? "completed" : "active",
      completedAt: change.completes ? new Date() : null,
    });
    historyRows.push({ instanceId: id, ...structuredClone(change), actorName: change.actor.name });
    return withVersion(instance);
  });
  mock.method(workflowInstancesRepository, "activeByVersion", async (appId) => {
    const counts = new Map();
    for (const instance of instances.filter((item) => item.appId === appId && item.status === "active")) {
      counts.set(instance.appVersionId, (counts.get(instance.appVersionId) ?? 0) + 1);
    }
    return [...counts].map(([appVersionId, active]) => ({
      appVersionId,
      versionNumber: versions.find((version) => version.id === appVersionId).number,
      active,
    }));
  });
}

/** Publica una versión nueva del formulario (la anterior queda archivada, como en versions.repository). */
function publish(workflow) {
  for (const version of versions) if (version.status === "current") version.status = "archived";
  const id = versions.length + 1;
  versions.push({ id, appId: "form", number: id, status: "current", config: { elements: [], workflow } });
}

before(async () => {
  Object.assign(process.env, {
    DB_SERVER: "test",
    DB_NAME: "test",
    DB_USER: "test",
    DB_PASSWORD: "test",
    WEB_ORIGIN: "http://127.0.0.1:5173",
  });
  originalConnect = sql.ConnectionPool.prototype.connect;
  sql.ConnectionPool.prototype.connect = async () => ({
    close: async () => {},
    request() {
      const values = {};
      return {
        input(name, _type, value) {
          values[name] = value;
          return this;
        },
        async query(query) {
          if (query.includes("FROM dbo.AuthSessions")) {
            const who = Object.keys(tokens).find((key) => tokenHash(tokens[key]) === values.hash);
            return { recordset: who ? [users[who]] : [] };
          }
          // Permisos del módulo: todos los roles de la prueba pueden ver el App Builder.
          if (query.includes("RoleModulePermissions")) {
            return { recordset: [{ ModuleKey: "app-builder", Level: "read" }] };
          }
          throw new Error(`Unexpected SQL: ${query.slice(0, 80)}`);
        },
      };
    },
  });
  const { default: app } = await import("../app.js");
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  api = `http://127.0.0.1:${server.address().port}/api/workflow`;
});

beforeEach(() => {
  mock.restoreAll();
  useInMemory();
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  sql.ConnectionPool.prototype.connect = originalConnect;
  mock.restoreAll();
  const { closeDB } = await import("../db/db.js");
  await closeDB();
});

const start = (who, body = { appId: "form", title: "Pagos sin firma del gerente" }) =>
  fetch(`${api}/instances`, { method: "POST", headers: as(who), body: JSON.stringify(body) });
const move = (who, id, body) =>
  fetch(`${api}/instances/${id}/transitions`, { method: "POST", headers: as(who), body: JSON.stringify(body) });
const detail = async (who, id) => (await (await fetch(`${api}/instances/${id}`, { headers: as(who) })).json()).instance;

test("fase 4: un auditor inicia un proceso con la versión publicada y queda en el estado inicial", async () => {
  const response = await start("auditor");
  assert.equal(response.status, 201);
  const { instance } = await response.json();
  assert.equal(instance.version.number, 1);
  assert.equal(instance.version.isCurrent, true);
  assert.deepEqual(instance.currentState, { id: "borrador", name: "Borrador", kind: "Inicial" });
  assert.equal(instance.startedBy, "Ana Auditora");

  const seen = await detail("auditor", instance.id);
  assert.deepEqual(
    seen.actions.map((action) => [action.transitionId, action.allowed]),
    [["enviar", true]],
  );
  assert.equal(seen.history[0].action, "iniciar");
  assert.equal(seen.history[0].toStateName, "Borrador");

  // Solo auditoría inicia; sin título o sin versión con flujo no se puede.
  assert.equal((await start("creador")).status, 403);
  assert.equal((await start("auditor", { appId: "form", title: "x" })).status, 400);
  versions[0].config.workflow = undefined;
  clearWorkflowCache();
  const noFlow = await start("auditor");
  assert.equal(noFlow.status, 409);
  assert.match((await noFlow.json()).msg, /no tiene flujo/);
});

test("fase 4: cada paso valida rol, requisitos y segregación de funciones; al llegar a un final termina", async () => {
  const { instance } = await (await start("auditor")).json();

  // «enviar» exige evidencia.
  const noEvidence = await move("auditor", instance.id, { transitionId: "enviar" });
  assert.equal(noEvidence.status, 400);
  assert.match((await noEvidence.json()).msg, /evidencia/);
  assert.equal(
    (await move("auditor", instance.id, { transitionId: "enviar", evidence: "Muestreo 40 pagos.xlsx" })).status,
    200,
  );

  // El auditor no puede cerrar (rol), el jefe sí puede devolver (pero con comentario).
  assert.equal((await move("auditor", instance.id, { transitionId: "cerrar" })).status, 403);
  assert.equal((await move("jefe", instance.id, { transitionId: "devolver" })).status, 400);
  assert.equal(
    (await move("jefe", instance.id, { transitionId: "devolver", comment: "Falta la política" })).status,
    200,
  );
  await move("auditor", instance.id, { transitionId: "reenviar" });

  // Una transición que no sale del estado actual: 409.
  assert.equal((await move("auditor", instance.id, { transitionId: "reenviar" })).status, 409);

  const closed = await (await move("jefe", instance.id, { transitionId: "cerrar" })).json();
  assert.equal(closed.instance.status, "completed");
  assert.equal(closed.instance.currentState.name, "Cerrado");
  assert.deepEqual(closed.instance.actions, []);
  assert.deepEqual(
    closed.instance.history.map((entry) => `${entry.action}:${entry.toStateName}:${entry.actorName}`),
    [
      "iniciar:Borrador:Ana Auditora",
      "enviar:Revisión del jefe:Ana Auditora",
      "devolver:Devuelto:Jorge Jefe",
      "reenviar:Revisión del jefe:Ana Auditora",
      "cerrar:Cerrado:Jorge Jefe",
    ],
  );
  assert.equal(closed.instance.history[2].comment, "Falta la política");
  assert.equal((await move("jefe", instance.id, { transitionId: "devolver", comment: "x" })).status, 409);

  // Segregación: el administrador puede actuar con cualquier rol, pero no cerrar lo que él inició.
  const own = (await (await start("admin")).json()).instance;
  await move("admin", own.id, { transitionId: "enviar", evidence: "doc" });
  const blocked = await move("admin", own.id, { transitionId: "cerrar" });
  assert.equal(blocked.status, 403);
  assert.match((await blocked.json()).msg, /Segregación de funciones/);
  assert.equal((await move("admin", own.id, { transitionId: "devolver", comment: "Devolver sí puede" })).status, 200);
});

test("fase 4: un proceso en curso termina con su versión aunque se publique otra; los nuevos usan la nueva", async () => {
  const { instance: old } = await (await start("auditor")).json();
  await move("auditor", old.id, { transitionId: "enviar", evidence: "doc" });

  publish(workflowV2);

  // El proceso viejo sigue con v1: ve «cerrar» (que en v2 ya no sale de revisión) y no ve «comunicar».
  const pinned = await detail("jefe", old.id);
  assert.deepEqual(pinned.version, { id: 1, number: 1, isCurrent: false });
  assert.deepEqual(
    pinned.actions.map((action) => action.transitionId),
    ["devolver", "cerrar"],
  );
  assert.equal(pinned.workflow.states.length, 4);
  const onlyInV2 = await move("jefe", old.id, { transitionId: "comunicar" });
  assert.equal(onlyInV2.status, 409);
  assert.match((await onlyInV2.json()).msg, /v1/);

  // Resumen para avisar al publicar: hay 1 proceso en curso con v1.
  const summary = await (await fetch(`${api}/instances/summary?appId=form`, { headers: as("jefe") })).json();
  assert.deepEqual(summary.activeByVersion, [{ appVersionId: 1, versionNumber: 1, active: 1 }]);

  // Uno nuevo arranca con v2.
  const { instance: fresh } = await (await start("auditor")).json();
  assert.equal(fresh.version.number, 2);
  await move("auditor", fresh.id, { transitionId: "enviar", evidence: "doc" });
  assert.deepEqual(
    (await detail("jefe", fresh.id)).actions.map((action) => action.transitionId),
    ["devolver", "comunicar"],
  );

  // El viejo termina con v1.
  const done = await (await move("jefe", old.id, { transitionId: "cerrar" })).json();
  assert.equal(done.instance.status, "completed");
  const list = await (await fetch(`${api}/instances?appId=form`, { headers: as("jefe") })).json();
  assert.deepEqual(list.instances.map((item) => [item.version.number, item.status]).sort(), [
    [1, "completed"],
    [2, "active"],
  ]);
});

test("fase 4: el plan de acción exige descripción, responsable y una fecha que no esté en el pasado", async () => {
  publish(workflowV2);
  const { instance } = await (await start("auditor")).json();
  await move("auditor", instance.id, { transitionId: "enviar", evidence: "doc" });
  await move("jefe", instance.id, { transitionId: "comunicar" });
  assert.equal((await move("director", instance.id, { transitionId: "responder" })).status, 400);
  const past = { description: "Bloquear pagos sin firma", owner: "Raúl Área", dueDate: "2020-01-01" };
  assert.equal((await move("director", instance.id, { transitionId: "responder", actionPlan: past })).status, 400);
  const plan = { ...past, dueDate: "2099-12-31" };
  const response = await move("director", instance.id, { transitionId: "responder", actionPlan: plan });
  assert.equal(response.status, 200);
  const { instance: closed } = await response.json();
  assert.deepEqual(closed.history.at(-1).actionPlan, plan);
});

test("fase 4: piden sesión y mismo origen; un proceso inexistente da 404", async () => {
  assert.equal((await fetch(`${api}/instances?appId=form`)).status, 401);
  const crossSite = await fetch(`${api}/instances`, {
    method: "POST",
    headers: { ...as("auditor"), Origin: "https://otro.example" },
    body: JSON.stringify({ appId: "form", title: "Proceso" }),
  });
  assert.equal(crossSite.status, 403);
  assert.equal((await fetch(`${api}/instances/no-existe`, { headers: as("auditor") })).status, 404);
  assert.equal((await fetch(`${api}/instances/${randomUUID()}`, { headers: as("auditor") })).status, 404);
});

test("fase 4: si faltan las tablas, responde 503 con la instrucción", async () => {
  mock.method(workflowInstancesRepository, "list", async () => {
    throw Object.assign(new Error("Invalid object name 'dbo.AppWorkflowInstances'."), { number: 208 });
  });
  mock.method(workflowInstancesRepository, "activeByVersion", async () => {
    throw Object.assign(new Error("Invalid object name 'dbo.AppWorkflowInstances'."), { number: 208 });
  });
  const response = await fetch(`${api}/instances?appId=form`, { headers: as("auditor") });
  assert.equal(response.status, 503);
  assert.match((await response.json()).msg, /npm run workflow:migrate/);
  // El aviso al publicar simplemente no aparece.
  const summary = await (await fetch(`${api}/instances/summary?appId=form`, { headers: as("auditor") })).json();
  assert.deepEqual(summary.activeByVersion, []);
});

test("fase 4: reglas puras (roles, aprobaciones, plazos, requisitos)", () => {
  assert.deepEqual(workflowRolesFor({ roleId: 12 }), ["Responsable del área"]);
  assert.deepEqual(workflowRolesFor({ roleId: 3 }), []);
  assert.equal(workflowRolesFor({ roleId: 2 }).length, 4);

  const find = (id) => workflowV2.transitions.find((item) => item.id === id);
  assert.equal(isApproval(workflowV2, find("comunicar")), true);
  assert.equal(isApproval(workflowV2, find("devolver")), false);
  assert.equal(isApproval(workflowV2, find("enviar")), false);
  assert.equal(isApproval(workflowV2, find("responder")), true);

  const instance = {
    status: "active",
    currentStateId: "revision",
    stateEnteredAt: "2026-11-01T00:00:00Z",
    startedById: "otro",
  };
  assert.deepEqual(stateTiming(workflowV1, instance, new Date("2026-11-09T00:00:00Z")), {
    daysInState: 8,
    slaDays: 5,
    overdue: true,
  });
  assert.equal(
    availableActions(workflowV1, instance, { id: "x", roleId: 12 }).every((action) => !action.allowed),
    true,
  );
  assert.equal(missingRequirement({ comment: true }, { comment: "ok" }), null);
  assert.match(missingRequirement({ actionPlan: true }, {}), /plan de acción/);
});
