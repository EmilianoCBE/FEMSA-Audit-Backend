import assert from "node:assert/strict";
import { after, before, beforeEach, mock, test } from "node:test";
import sql from "mssql";
import { versionsRepository } from "../repositories/versions.repository.js";
import { validateChanges, validateConfig } from "../services/versions.service.js";
import { SESSION_COOKIE, tokenHash } from "../utils/session.js";

// La BD solo se simula para la sesión; el repositorio de versiones se reemplaza por uno en memoria.
const token = "a".repeat(64);
const sessionUser = { Id: "00000000-0000-4000-8000-000000000001", Name: "Rafael Valdez", Role: "Administrador" };
const auth = { Cookie: `${SESSION_COOKIE}=${token}` };
const jsonHeaders = { ...auth, "Content-Type": "application/json" };
const appId = "layout dummy";
const config = { elements: [{ id: "titulo", type: "short-text", x: 24, y: 24, width: 280, height: 48, config: {} }] };

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

  mock.method(versionsRepository, "list", async (id) =>
    rows
      .filter((row) => row.appId === id)
      .sort((a, b) => b.number - a.number)
      .map((row) => {
        const { config: _config, ...summary } = withSource(row);
        return summary;
      }),
  );
  mock.method(versionsRepository, "findById", async (id, versionId) => {
    const row = rows.find((candidate) => candidate.appId === id && candidate.id === versionId);
    return row ? withSource(row) : null;
  });
  mock.method(versionsRepository, "create", async ({ restoredFromId = null, ...data }) => {
    const number = Math.max(0, ...rows.filter((row) => row.appId === data.appId).map((row) => row.number)) + 1;
    const row = { ...copy(data), id: rows.length + 1, number, status: "draft", restoredFromId };
    Object.assign(row, { createdAt: new Date(), publishedAt: null });
    rows.push(row);
    return withSource(row);
  });
  mock.method(versionsRepository, "publish", async (id, versionId) => {
    for (const row of rows) if (row.appId === id && row.status === "current") row.status = "archived";
    const row = rows.find((candidate) => candidate.appId === id && candidate.id === versionId);
    Object.assign(row, { status: "current", publishedAt: new Date() });
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
            return { recordset: values.hash === tokenHash(token) ? [sessionUser] : [] };
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
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  sql.ConnectionPool.prototype.connect = originalConnect;
  const { closeDB } = await import("../db/db.js");
  await closeDB();
});

const saveVersion = (body) => fetch(base, { method: "POST", headers: jsonHeaders, body: JSON.stringify(body) });
const action = (id, name) => fetch(`${base}/${id}/${name}`, { method: "POST", headers: auth });

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

test("US11 guarda versiones numeradas con autor y cambios", async () => {
  const first = await saveVersion({ config, changes: ["  Se agregó el campo Título  "] });
  assert.equal(first.status, 201);
  const { version } = await first.json();
  assert.equal(version.version, "v1");
  assert.equal(version.status, "draft");
  assert.equal(version.author, "Rafael Valdez");
  assert.deepEqual(version.changes, ["Se agregó el campo Título"]);
  assert.equal(version.publishedAt, null);
  assert.deepEqual(versionsRepository.create.mock.calls[0].arguments[0].authorId, sessionUser.Id);

  const second = await (await saveVersion({ config, changes: ["Otro cambio"] })).json();
  assert.equal(second.version.version, "v2");
});

test("US11 consulta el historial (más reciente primero) y el detalle con la configuración", async () => {
  await saveVersion({ config, changes: ["Primera"] });
  await saveVersion({ config: { elements: [] }, changes: ["Segunda"] });

  const listResponse = await fetch(base, { headers: auth });
  assert.equal(listResponse.status, 200);
  assert.equal(listResponse.headers.get("cache-control"), "no-store");
  const { versions } = await listResponse.json();
  assert.deepEqual(
    versions.map((version) => version.version),
    ["v2", "v1"],
  );
  assert.equal(versions[0].config, undefined);

  const detail = await (await fetch(`${base}/${versions[1].id}`, { headers: auth })).json();
  assert.deepEqual(detail.version.config, config);
});

test("US11 publica un borrador y archiva la versión vigente anterior", async () => {
  const v1 = (await (await saveVersion({ config, changes: ["Primera"] })).json()).version;
  const v2 = (await (await saveVersion({ config, changes: ["Segunda"] })).json()).version;

  const published = await (await action(v1.id, "publish")).json();
  assert.equal(published.version.status, "current");
  assert.ok(published.version.publishedAt);

  await action(v2.id, "publish");
  const { versions } = await (await fetch(base, { headers: auth })).json();
  assert.deepEqual(
    versions.map((version) => version.status),
    ["current", "archived"],
  );

  const again = await action(v1.id, "publish");
  assert.equal(again.status, 409);
});

test("US11 restaura una configuración anterior como borrador nuevo sin borrar el historial", async () => {
  const v1 = (await (await saveVersion({ config, changes: ["Primera"] })).json()).version;
  await saveVersion({ config: { elements: [] }, changes: ["Se quitaron los campos"] });

  const response = await action(v1.id, "restore");
  assert.equal(response.status, 201);
  const { version } = await response.json();
  assert.equal(version.version, "v3");
  assert.equal(version.status, "draft");
  assert.equal(version.restoredFrom, "v1");
  assert.deepEqual(version.config, config);
  assert.deepEqual(version.changes, ["Se restauró la configuración de la versión v1"]);
  assert.equal(rows.length, 3);
});

test("US11 responde 404 para versiones inexistentes o ids inválidos", async () => {
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
