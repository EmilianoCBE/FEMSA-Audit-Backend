import assert from "node:assert/strict";
import { after, before, beforeEach, mock, test } from "node:test";
import sql from "mssql";
import { findDesignerLayout, saveDesignerCanvas } from "../models/designer.model.js";
import { versionsRepository } from "../repositories/versions.repository.js";
import { canEditVersions, sameJson, validateChanges, validateConfig } from "../services/versions.service.js";
import { SESSION_COOKIE, tokenHash } from "../utils/session.js";

// La BD solo se simula para la sesión; el repositorio de versiones se reemplaza por uno en memoria.
const editorToken = "a".repeat(64);
const viewerToken = "b".repeat(64);
const sessions = {
  [tokenHash(editorToken)]: {
    Id: "00000000-0000-4000-8000-000000000001",
    Name: "Rafael Valdez",
    Role: "Administrador",
  },
  [tokenHash(viewerToken)]: { Id: "00000000-0000-4000-8000-000000000003", Name: "Vera Vista", Role: "Visualizador" },
};
const auth = { Cookie: `${SESSION_COOKIE}=${editorToken}` };
const viewerAuth = { Cookie: `${SESSION_COOKIE}=${viewerToken}` };
const jsonHeaders = { ...auth, "Content-Type": "application/json" };
const appId = "layout dummy";
const element = (id, label) => ({ id, type: "short-text", x: 24, y: 24, width: 280, height: 48, config: { label } });
const config = { elements: [element("titulo", "Título")] };
const otherConfig = { elements: [element("titulo", "Título"), element("monto", "Monto")] };

let server;
let base;
let originalConnect;
let rows;

function useInMemoryRepository() {
  rows = [];
  const copy = (row) => structuredClone(row);
  const withSource = (row) => ({
    ...copy(row),
    restoredFromNumber: rows.find((source) => source.id === row.restoredFromId)?.number ?? null,
  });
  const visible = (id) =>
    rows.filter((row) => row.appId === id && row.status !== "discarded").sort((a, b) => b.number - a.number);

  mock.method(versionsRepository, "list", async (id) =>
    visible(id).map((row) => {
      const { config: _config, ...summary } = withSource(row);
      return summary;
    }),
  );
  mock.method(versionsRepository, "findById", async (id, versionId) => {
    const row = rows.find((candidate) => candidate.appId === id && candidate.id === versionId);
    return row ? withSource(row) : null;
  });
  mock.method(versionsRepository, "findLatest", async (id) => {
    const [row] = visible(id);
    return row ? withSource(row) : null;
  });
  mock.method(versionsRepository, "create", async ({ restoredFromId = null, ...data }) => {
    const number = Math.max(0, ...rows.filter((row) => row.appId === data.appId).map((row) => row.number)) + 1;
    const row = { ...copy(data), id: rows.length + 1, number, status: "draft", restoredFromId };
    Object.assign(row, { createdAt: new Date(), publishedAt: null, publishedByName: null });
    rows.push(row);
    return withSource(row);
  });
  // Igual que el SQL: si el borrador ya no está en borrador, no cambia nada y devuelve null.
  mock.method(versionsRepository, "publish", async (id, versionId, { userName }) => {
    const row = rows.find((candidate) => candidate.appId === id && candidate.id === versionId);
    if (row?.status !== "draft") return null;
    for (const other of rows) if (other.appId === id && other.status === "current") other.status = "archived";
    Object.assign(row, { status: "current", publishedAt: new Date(), publishedByName: userName });
    return withSource(row);
  });
  mock.method(versionsRepository, "discard", async (id, versionId, { userName }) => {
    const row = rows.find((candidate) => candidate.appId === id && candidate.id === versionId);
    if (row?.status !== "draft") return null;
    Object.assign(row, { status: "discarded", discardedAt: new Date(), discardedByName: userName });
    return withSource(row);
  });
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
        input(name, type, value) {
          values[name] = value;
          return this;
        },
        async query(query) {
          if (query.includes("FROM dbo.AuthSessions")) {
            const user = sessions[values.hash];
            return { recordset: user ? [user] : [] };
          }
          throw new Error("Unexpected SQL");
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
  base = `http://127.0.0.1:${server.address().port}/api/apps/${encodeURIComponent(appId)}/versions`;
});

beforeEach(() => {
  mock.restoreAll();
  useInMemoryRepository();
  // El lienzo del Designer vive en memoria del proceso: cada prueba arranca con `config`.
  saveDesignerCanvas(appId, config.elements);
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  sql.ConnectionPool.prototype.connect = originalConnect;
  const { closeDB } = await import("../db/db.js");
  await closeDB();
});

const saveVersion = (body, headers = jsonHeaders) =>
  fetch(base, { method: "POST", headers, body: JSON.stringify(body) });
const saved = async (body) => (await (await saveVersion(body)).json()).version;
const action = (id, name, headers = auth) => fetch(`${base}/${id}/${name}`, { method: "POST", headers });
const history = async (headers = auth) => (await fetch(base, { headers })).json();

test("US11 requiere sesión y rechaza escrituras desde otro origen", async () => {
  assert.equal((await fetch(base)).status, 401);
  const response = await fetch(base, {
    method: "POST",
    headers: { ...jsonHeaders, Origin: "https://otro.example" },
    body: JSON.stringify({ config, changes: ["Cambio"] }),
  });
  assert.equal(response.status, 403);
  assert.equal(versionsRepository.create.mock.callCount(), 0);
});

test("US11 solo Administrador y Creador de aplicaciones modifican versiones; los demás solo consultan", async () => {
  const v1 = await saved({ config, changes: ["Primera"] });
  const viewerJson = { ...viewerAuth, "Content-Type": "application/json" };

  assert.equal((await saveVersion({ config: otherConfig, changes: ["X"] }, viewerJson)).status, 403);
  for (const name of ["publish", "discard", "restore"]) {
    assert.equal((await action(v1.id, name, viewerAuth)).status, 403, name);
  }
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "draft");

  const viewerHistory = await history(viewerAuth);
  assert.equal(viewerHistory.versions.length, 1);
  assert.equal(viewerHistory.canEdit, false);
  assert.equal((await history()).canEdit, true);

  assert.equal(canEditVersions({ role: "creador de aplicaciones" }), true);
  assert.equal(canEditVersions({ role: "Auditor" }), false);
  assert.equal(canEditVersions(undefined), false);
});

test("US11 guarda versiones numeradas con autor y cambios", async () => {
  const first = await saveVersion({ config, changes: ["  Se agregó el campo Título  "] });
  assert.equal(first.status, 201);
  const { version } = await first.json();
  assert.equal(version.version, "v1");
  assert.equal(version.status, "draft");
  assert.equal(version.author, "Rafael Valdez");
  assert.deepEqual(version.changes, ["Se agregó el campo Título"]);
  assert.equal(version.publishedAt, null);
  assert.ok(version.createdAt);
  assert.deepEqual(versionsRepository.create.mock.calls[0].arguments[0].authorId, sessions[tokenHash(editorToken)].Id);

  const second = await saved({ config: otherConfig, changes: ["Otro cambio"] });
  assert.equal(second.version, "v2");
});

test("US11 no guarda una versión idéntica a la más reciente", async () => {
  await saved({ config, changes: ["Primera"] });
  // Mismo contenido con las llaves en otro orden: sigue siendo la misma configuración.
  const reordered = { elements: config.elements.map(({ config: c, ...rest }) => ({ config: c, ...rest })) };
  const response = await saveVersion({ config: reordered, changes: ["Repetida"] });
  assert.equal(response.status, 409);
  assert.match((await response.json()).msg, /No hay cambios desde v1/);
  assert.equal(rows.length, 1);

  assert.ok(sameJson({ a: 1, b: [1, { c: 2, d: 3 }] }, { b: [1, { d: 3, c: 2 }], a: 1 }));
  assert.ok(!sameJson({ a: [1, 2] }, { a: [2, 1] }));
});

test("US11 consulta el historial, el detalle y si el Designer tiene cambios sin versión", async () => {
  saveDesignerCanvas(appId, []);
  let body = await history();
  assert.deepEqual(body.versions, []);
  assert.deepEqual(body.designer, { versionId: null, hasUnversionedChanges: false });

  saveDesignerCanvas(appId, config.elements);
  assert.equal((await history()).designer.hasUnversionedChanges, true);

  await saved({ config: otherConfig, changes: ["Primera"] });
  const v2 = await saved({ config, changes: ["Segunda"] });

  const listResponse = await fetch(base, { headers: auth });
  assert.equal(listResponse.status, 200);
  assert.equal(listResponse.headers.get("cache-control"), "no-store");
  body = await listResponse.json();
  assert.deepEqual(
    body.versions.map((version) => version.version),
    ["v2", "v1"],
  );
  assert.equal(body.versions[0].config, undefined);
  assert.deepEqual(body.designer, { versionId: v2.id, hasUnversionedChanges: false });

  saveDesignerCanvas(appId, otherConfig.elements);
  assert.deepEqual((await history()).designer, { versionId: null, hasUnversionedChanges: true });

  const detail = await (await fetch(`${base}/${body.versions[1].id}`, { headers: auth })).json();
  assert.deepEqual(detail.version.config, otherConfig);
});

test("US11 publica un borrador, guarda quién lo publicó y archiva la vigente anterior", async () => {
  const v1 = await saved({ config, changes: ["Primera"] });
  const v2 = await saved({ config: otherConfig, changes: ["Segunda"] });

  const published = await (await action(v1.id, "publish")).json();
  assert.equal(published.version.status, "current");
  assert.ok(published.version.publishedAt);
  assert.equal(published.version.publishedBy, "Rafael Valdez");
  assert.equal(versionsRepository.publish.mock.calls[0].arguments[2].userId, sessions[tokenHash(editorToken)].Id);

  await action(v2.id, "publish");
  const { versions } = await history();
  assert.deepEqual(
    versions.map((version) => version.status),
    ["current", "archived"],
  );

  const again = await action(v1.id, "publish");
  assert.equal(again.status, 409);
  assert.match((await again.json()).msg, /archivada\. Restáurala/);
});

test("US11 si otra sesión publica primero, responde 409 en lugar de dejar la app sin vigente", async () => {
  const v1 = await saved({ config, changes: ["Primera"] });
  // Simula la carrera: la validación del servicio vio el borrador, pero el UPDATE ya no lo encuentra.
  versionsRepository.publish.mock.mockImplementationOnce(async () => null);

  const response = await action(v1.id, "publish");
  assert.equal(response.status, 409);
  assert.match((await response.json()).msg, /otra sesión/);
});

test("US11 descarta borradores sin reutilizar su número", async () => {
  const v1 = await saved({ config, changes: ["Primera"] });
  const v2 = await saved({ config: otherConfig, changes: ["Prueba"] });
  await action(v1.id, "publish");

  const response = await action(v2.id, "discard");
  assert.equal(response.status, 200);
  const { version } = await response.json();
  assert.equal(version.status, "discarded");
  assert.equal(version.discardedBy, "Rafael Valdez");

  const { versions } = await history();
  assert.deepEqual(
    versions.map((item) => item.version),
    ["v1"],
  );
  assert.equal((await saved({ config: otherConfig, changes: ["Nueva"] })).version, "v3");

  assert.equal((await action(v1.id, "discard")).status, 409);
  assert.equal((await action(v2.id, "restore")).status, 409);
  assert.equal((await action(v2.id, "publish")).status, 409);
});

test("US11 restaura una configuración anterior y la aplica al Designer sin borrar historial", async () => {
  const v1 = await saved({ config: otherConfig, changes: ["Primera"] });
  await saved({ config, changes: ["Se quitó Monto"] });

  const response = await action(v1.id, "restore");
  assert.equal(response.status, 201);
  const { version, backup } = await response.json();
  assert.equal(backup, null, "el lienzo era igual a v2: no hacía falta respaldo");
  assert.equal(version.version, "v3");
  assert.equal(version.status, "draft");
  assert.equal(version.restoredFrom, "v1");
  assert.deepEqual(version.config, otherConfig);
  assert.deepEqual(version.changes, ["Se restauró la configuración de la versión v1"]);
  assert.deepEqual(
    findDesignerLayout(appId).elements.map((item) => item.id),
    ["titulo", "monto"],
  );
  assert.equal(rows.length, 3);

  const again = await action(v1.id, "restore");
  assert.equal(again.status, 409);
  assert.match((await again.json()).msg, /ya tiene la configuración de v1/);
});

test("US11 antes de restaurar respalda los cambios del Designer que no están en ninguna versión", async () => {
  const v1 = await saved({ config, changes: ["Primera"] });
  const unversioned = [element("titulo", "Título"), element("riesgo", "Riesgo residual")];
  saveDesignerCanvas(appId, unversioned);
  await saved({ config: otherConfig, changes: ["Segunda"] });

  const { version, backup } = await (await action(v1.id, "restore")).json();
  assert.equal(backup.version, "v3");
  assert.deepEqual(backup.changes, ["Estado del Designer antes de restaurar v1"]);
  assert.deepEqual(
    rows.find((row) => row.number === 3).config.elements.map((item) => item.id),
    ["titulo", "riesgo"],
  );
  assert.equal(version.version, "v4");
  assert.deepEqual(findDesignerLayout(appId).elements, config.elements);
});

test("US11 responde 404 para aplicaciones o versiones inexistentes e ids inválidos", async () => {
  const missingApp = base.replace(encodeURIComponent(appId), "no-existe");
  assert.equal((await fetch(missingApp, { headers: auth })).status, 404);
  const response = await fetch(missingApp, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ config, changes: ["Huérfana"] }),
  });
  assert.equal(response.status, 404);
  assert.equal(versionsRepository.create.mock.callCount(), 0);

  assert.equal((await fetch(`${base}/999`, { headers: auth })).status, 404);
  assert.equal((await fetch(`${base}/abc`, { headers: auth })).status, 404);
  assert.equal((await action("999", "restore")).status, 404);
  assert.equal(versionsRepository.findById.mock.callCount(), 2);
});

test("US11 valida config y cambios al guardar", async () => {
  for (const body of [
    { changes: ["Cambio"] },
    { config: [], changes: ["Cambio"] },
    { config, changes: [] },
    { config, changes: ["   "] },
    { config, changes: "Cambio" },
  ]) {
    const response = await saveVersion(body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.ok((await response.json()).msg);
  }
  assert.equal(versionsRepository.create.mock.callCount(), 0);
});

test("US11 acepta configuraciones mayores al límite general de 16 KB", async () => {
  const bigConfig = { elements: [], notes: "x".repeat(40_000) };
  assert.equal((await saveVersion({ config: bigConfig, changes: ["Grande"] })).status, 201);
});

test("US11 reglas de validación puras", () => {
  assert.throws(() => validateChanges(Array.from({ length: 21 }, () => "c")), /Máximo 20/);
  assert.throws(() => validateChanges(["x".repeat(301)]), /1 a 300/);
  assert.throws(() => validateConfig(null), /objeto/);
  assert.deepEqual(validateChanges([" a ", "b"]), ["a", "b"]);
});
