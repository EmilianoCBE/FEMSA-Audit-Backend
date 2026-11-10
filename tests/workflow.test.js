import assert from "node:assert/strict";
import { after, before, beforeEach, mock, test } from "node:test";
import sql from "mssql";
import { saveDesignerCanvas, saveDesignerWorkflow } from "../models/designer.model.js";
import { versionsRepository } from "../repositories/versions.repository.js";
import { parseWorkflow } from "../services/workflow.schema.js";
import { SESSION_COOKIE, tokenHash } from "../utils/session.js";

// Fase 1 del workflow: el flujo se guarda con el formulario y entra en AppVersions.config.workflow.
// La BD solo se simula para la sesión y los permisos; las versiones viven en un repositorio en memoria.
const editorToken = "c".repeat(64);
const viewerToken = "d".repeat(64);
const sessions = {
  [tokenHash(editorToken)]: {
    Id: "00000000-0000-4000-8000-000000000011",
    Name: "Ana Editora",
    Role: "Administrador",
    RoleId: 2,
  },
  [tokenHash(viewerToken)]: {
    Id: "00000000-0000-4000-8000-000000000012",
    Name: "Vera Vista",
    Role: "Visualizador",
    RoleId: 4,
  },
};
const headers = { Cookie: `${SESSION_COOKIE}=${editorToken}`, "Content-Type": "application/json" };
const viewerHeaders = { Cookie: `${SESSION_COOKIE}=${viewerToken}`, "Content-Type": "application/json" };
const appId = "layout dummy";
const elements = [
  { id: "titulo", type: "short-text", x: 24, y: 24, width: 280, height: 48, config: { label: "Título" } },
];

const state = (id, kind, x) => ({ id, kind, name: id, tone: "neutral", position: { x, y: 20 } });
const transition = (id, from, to, role = "Auditor") => ({ id, label: id, from, to, role, variant: "default" });
const workflow = (extra = []) => ({
  size: { width: 800, height: 300 },
  states: [state("borrador", "Inicial", 0), state("revision", "En proceso", 200), state("cerrado", "Final", 400)],
  transitions: [transition("enviar", "borrador", "revision"), transition("cerrar", "revision", "cerrado"), ...extra],
  suggestedStates: [],
  annotations: [],
});

let server;
let api;
let originalConnect;
let rows = [];

function useInMemoryRepository() {
  rows = [];
  const visible = (id) => rows.filter((row) => row.appId === id).sort((a, b) => b.number - a.number);
  const withSource = (row) => ({ ...structuredClone(row), restoredFromNumber: null });
  mock.method(versionsRepository, "list", async (id) => visible(id).map(({ config: _c, ...row }) => withSource(row)));
  mock.method(versionsRepository, "findLatest", async (id) => (visible(id)[0] ? withSource(visible(id)[0]) : null));
  mock.method(versionsRepository, "findById", async (id, versionId) => {
    const row = rows.find((candidate) => candidate.appId === id && candidate.id === versionId);
    return row ? withSource(row) : null;
  });
  mock.method(versionsRepository, "create", async ({ restoredFromId = null, ...data }) => {
    const row = {
      ...structuredClone(data),
      id: rows.length + 1,
      number: rows.length + 1,
      status: "draft",
      restoredFromId,
    };
    Object.assign(row, { createdAt: new Date(), publishedAt: null });
    rows.push(row);
    return withSource(row);
  });
}

before(async () => {
  Object.assign(process.env, {
    DB_SERVER: "t",
    DB_NAME: "t",
    DB_USER: "t",
    DB_PASSWORD: "t",
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
          if (query.includes("FROM dbo.AuthSessions"))
            return { recordset: sessions[values.hash] ? [sessions[values.hash]] : [] };
          if (query.includes("FROM dbo.RoleModulePermissions")) {
            return { recordset: [{ ModuleKey: "app-builder", Level: values.roleId === 4 ? "read" : "edit" }] };
          }
          throw new Error("Unexpected SQL");
        },
      };
    },
  });
  const { default: app } = await import("../app.js");
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  api = `http://127.0.0.1:${server.address().port}/api`;
});

beforeEach(() => {
  mock.restoreAll();
  useInMemoryRepository();
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  sql.ConnectionPool.prototype.connect = originalConnect;
  const { closeDB } = await import("../db/db.js");
  await closeDB();
});

const putWorkflow = (body, extra = headers) =>
  fetch(`${api}/designer/layouts/${encodeURIComponent(appId)}/workflow`, {
    method: "PUT",
    headers: extra,
    body: JSON.stringify(body),
  });
const getLayout = async () =>
  (await (await fetch(`${api}/designer/layouts/${encodeURIComponent(appId)}`, { headers })).json()).layout;
const versionsUrl = () => `${api}/apps/${encodeURIComponent(appId)}/versions`;
const saveVersion = async (config) =>
  (
    await (
      await fetch(versionsUrl(), { method: "POST", headers, body: JSON.stringify({ config, changes: ["prueba"] }) })
    ).json()
  ).version;
const history = async () => (await fetch(versionsUrl(), { headers })).json();

// Va primero: el layout de ejemplo solo se carga desde las versiones la primera vez en cada proceso.
test("al arrancar, el flujo se carga de la última versión guardada junto con los campos", async () => {
  rows.push({
    appId,
    id: 1,
    number: 1,
    status: "current",
    config: { elements, workflow: workflow() },
    createdAt: new Date(),
  });
  const layout = await getLayout();
  assert.deepEqual(layout.workflow, workflow());
  assert.deepEqual(
    layout.elements.map((element) => element.id),
    ["titulo"],
  );
});

test("guarda el flujo del formulario y lo devuelve con el layout", async () => {
  const response = await putWorkflow({
    workflow: workflow([transition("devolver", "revision", "borrador", "Jefe de Auditoría")]),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).layout.workflow.transitions.length, 3);
  assert.equal((await getLayout()).workflow.transitions[2].role, "Jefe de Auditoría");
});

test("pide permiso de edición, mismo origen y un layout que exista", async () => {
  const body = { workflow: workflow() };
  assert.equal((await putWorkflow(body, { "Content-Type": "application/json" })).status, 401);
  assert.equal((await putWorkflow(body, viewerHeaders)).status, 403);
  assert.equal((await putWorkflow(body, { ...headers, "Sec-Fetch-Site": "cross-site" })).status, 403);
  const missing = await fetch(`${api}/designer/layouts/no-existe/workflow`, {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });
  assert.equal(missing.status, 404);
});

test("rechaza flujos inválidos con un mensaje claro", async () => {
  const cases = [
    [{}, /no es válido/],
    [{ workflow: { ...workflow(), states: [] } }, /no es válido/],
    [{ workflow: workflow([transition("x", "revision", "fantasma")]) }, /«x» apunta a un estado que no existe/],
    [{ workflow: workflow([transition("enviar", "revision", "cerrado")]) }, /transiciones con el mismo id/],
    [
      { workflow: { ...workflow(), states: [...workflow().states, state("revision", "Final", 600)] } },
      /estados con el mismo id/,
    ],
    [{ workflow: workflow([{ ...transition("y", "revision", "cerrado"), variant: "otra" }]) }, /no es válido/],
  ];
  for (const [body, message] of cases) {
    const response = await putWorkflow(body);
    assert.equal(response.status, 400, JSON.stringify(body).slice(0, 80));
    assert.match((await response.json()).message, message);
  }
});

test("US11 una versión guarda el flujo aunque el front solo mande los campos, y avisa si el flujo cambió", async () => {
  saveDesignerCanvas(appId, elements);
  saveDesignerWorkflow(appId, workflow());
  const first = await saveVersion({ elements });
  assert.equal(first.version, "v1");
  assert.deepEqual(rows[0].config.workflow, workflow());
  assert.equal((await history()).designer.hasUnversionedChanges, false);

  await putWorkflow({ workflow: workflow([transition("devolver", "revision", "borrador")]) });
  assert.equal((await history()).designer.hasUnversionedChanges, true, "cambiar solo el flujo cuenta como cambio");
  await saveVersion({ elements });
  assert.equal(rows[1].config.workflow.transitions.length, 3);
  assert.equal((await history()).designer.hasUnversionedChanges, false);
});

test("US11 restaurar una versión también regresa su flujo, y una versión sin flujo lo deja sin flujo", async () => {
  saveDesignerCanvas(appId, elements);
  saveDesignerWorkflow(appId, null);
  rows.push({ appId, id: 1, number: 1, status: "archived", config: { elements }, createdAt: new Date() });
  rows.push({
    appId,
    id: 2,
    number: 2,
    status: "current",
    config: { elements, workflow: workflow() },
    createdAt: new Date(),
  });

  const restore = (id) => fetch(`${versionsUrl()}/${id}/restore`, { method: "POST", headers });
  assert.equal((await restore(2)).status, 201);
  assert.deepEqual((await getLayout()).workflow, workflow());
  assert.equal((await restore(1)).status, 201);
  assert.equal((await getLayout()).workflow, null);
});

test("reglas puras del flujo", () => {
  assert.deepEqual(parseWorkflow(workflow()).suggestedStates, []);
  const withSuggested = {
    ...workflow([transition("sugerida", "revision", "riesgo")]),
    suggestedStates: [{ id: "riesgo", kind: "Sugerido", name: "Riesgo", position: { x: 1, y: 2 } }],
  };
  assert.equal(parseWorkflow(withSuggested).transitions.length, 3, "una transición puede llegar a un estado sugerido");
  assert.throws(() => parseWorkflow({ ...workflow(), size: { width: -1, height: 1 } }), { status: 400 });
});
