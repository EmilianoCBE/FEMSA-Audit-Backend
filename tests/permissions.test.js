import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import sql from "mssql";
import { SESSION_COOKIE, tokenHash } from "../utils/session.js";
import { allows } from "../utils/permissions.js";

const adminToken = "a".repeat(64);
const viewerToken = "b".repeat(64);
const roles = [
  { role_id: 2, name: "Administrador" },
  { role_id: 3, name: "Visualizador" },
];
const viewer = { Id: "viewer", Name: "Vic Viewer", Role: "Visualizador", RoleId: 3 };
const admin = { Id: "admin", Name: "Ada Admin", Role: "Administrador", RoleId: 2 };
const sessions = new Map([
  [tokenHash(adminToken), admin],
  [tokenHash(viewerToken), viewer],
]);
const headers = (token) => ({ Cookie: `${SESSION_COOKIE}=${token}`, "Content-Type": "application/json" });
let rows;
let server;
let base;
let originalConnect;

before(async () => {
  Object.assign(process.env, { DB_SERVER: "test", DB_NAME: "test", DB_USER: "test", DB_PASSWORD: "test" });
  originalConnect = sql.ConnectionPool.prototype.connect;
  sql.ConnectionPool.prototype.connect = async () => ({
    close: async () => {},
    request() {
      const values = {};
      return {
        input(key, type, value) {
          values[key] = value;
          return this;
        },
        async query(query) {
          if (query.includes("FROM dbo.AuthSessions"))
            return { recordset: sessions.has(values.hash) ? [sessions.get(values.hash)] : [] };
          if (query.includes("MERGE dbo.RoleModulePermissions")) {
            if (!roles.some((role) => role.role_id === values.roleId)) return { recordset: [{ found: false }] };
            const row = rows.find((item) => item.RoleId === values.roleId && item.ModuleKey === values.moduleId);
            if (row) row.Level = values.level;
            else rows.push({ RoleId: values.roleId, ModuleKey: values.moduleId, Level: values.level });
            return { recordset: [{ found: true }] };
          }
          if (query.includes("FROM dbo.RoleModulePermissions"))
            return { recordset: rows.filter((row) => !values.roleId || row.RoleId === values.roleId) };
          if (query.includes("FROM dbo.[ROLE]")) return { recordset: roles };
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
  base = `http://127.0.0.1:${server.address().port}/api`;
});
beforeEach(() => {
  viewer.RoleId = 3;
  rows = ["app-builder", "risks", "reports"].map((ModuleKey) => ({ RoleId: 3, ModuleKey, Level: "read" }));
});
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  sql.ConnectionPool.prototype.connect = originalConnect;
  await (await import("../db/db.js")).closeDB();
});
const put = (roleId, moduleId, level, token = adminToken, extra = {}) =>
  fetch(`${base}/permissions/${roleId}/${moduleId}`, {
    method: "PUT",
    headers: { ...headers(token), ...extra },
    body: JSON.stringify({ level }),
  });

test("US13 requiere sesión y solo el administrador puede administrar permisos", async () => {
  assert.equal((await fetch(`${base}/permissions`)).status, 401);
  assert.equal((await fetch(`${base}/permissions/me`)).status, 401);
  assert.equal((await fetch(`${base}/permissions`, { headers: headers(viewerToken) })).status, 403);
  assert.equal((await put(3, "risks", "edit", viewerToken)).status, 403);
});
test("US13 devuelve los roles reales y guarda cambios que sobreviven nuevas consultas", async () => {
  const response = await fetch(`${base}/permissions`, { headers: headers(adminToken) });
  assert.equal(response.status, 200);
  const matrix = await response.json();
  assert.deepEqual(
    matrix.roles.map((role) => role.id),
    ["2", "3"],
  );
  assert.equal(matrix.permissions.find((row) => row.fieldId === "risks").levels[3], "read");
  assert.equal((await put(3, "risks", "edit")).status, 200);
  const updated = await (await fetch(`${base}/permissions`, { headers: headers(adminToken) })).json();
  assert.equal(updated.permissions.find((row) => row.fieldId === "risks").levels[3], "edit");
  const effective = await (await fetch(`${base}/permissions/me`, { headers: headers(viewerToken) })).json();
  assert.equal(effective.permissions.risks, "edit");
  assert.equal(effective.canManagePermissions, false);
});
test("US13 rechaza roles, módulos, niveles y orígenes inválidos sin cambiar permisos", async () => {
  for (const args of [
    ["abc", "risks", "read"],
    [0, "risks", "read"],
    [3, "unknown", "edit"],
    [3, "risks", "owner"],
    [3, "risks", null],
  ]) {
    assert.equal((await put(...args)).status, 400);
  }
  assert.equal((await put(999, "risks", "edit")).status, 404);
  assert.equal((await put(3, "risks", "edit", adminToken, { Origin: "https://evil.example" })).status, 403);
  assert.equal(rows.find((row) => row.ModuleKey === "risks").Level, "read");
});
test("US13 impide reducir permisos de administrador y siempre le da acceso completo", async () => {
  assert.equal((await put(2, "app-builder", "hidden")).status, 409);
  const body = await (await fetch(`${base}/permissions/me`, { headers: headers(adminToken) })).json();
  assert.deepEqual(Object.values(body.permissions), ["edit", "edit", "edit"]);
  assert.equal(body.canManagePermissions, true);
});
test("US13 aplica revocaciones a una sesión existente y protege llamadas directas a la API", async () => {
  // La clasificación es un cálculo sin escritura, disponible en lectura.
  const classify = () =>
    fetch(`${base}/risks/classify`, {
      method: "POST",
      headers: headers(viewerToken),
      body: JSON.stringify({ probability: 2, impact: 3 }),
    });
  assert.equal((await classify()).status, 200);
  const save = () => fetch(`${base}/risk-evaluations`, { method: "POST", headers: headers(viewerToken), body: "{}" });
  assert.equal((await save()).status, 403);
  assert.equal((await put(3, "risks", "edit")).status, 200);
  assert.equal((await save()).status, 400); // llega al controlador y valida el cuerpo
  assert.equal((await put(3, "risks", "hidden")).status, 200);
  assert.equal((await classify()).status, 403);
  assert.equal((await fetch(`${base}/risk-library`, { headers: headers(viewerToken) })).status, 403);
  assert.equal((await put(3, "app-builder", "hidden")).status, 200);
  assert.equal((await fetch(`${base}/designer/layouts`, { headers: headers(viewerToken) })).status, 403);
  assert.equal((await fetch(`${base}/apps/a/versions`, { headers: headers(viewerToken) })).status, 403);
});
test("US13 hereda los permisos del nuevo rol sin copiar configuración a la cuenta", async () => {
  viewer.RoleId = 2;
  let body = await (await fetch(`${base}/permissions/me`, { headers: headers(viewerToken) })).json();
  assert.equal(body.permissions.risks, "edit");
  viewer.RoleId = 99;
  body = await (await fetch(`${base}/permissions/me`, { headers: headers(viewerToken) })).json();
  assert.deepEqual(Object.values(body.permissions), ["hidden", "hidden", "hidden"]);
});
test("US13 lectura nunca permite métodos de escritura", () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) assert.equal(allows("read", method), false);
  for (const method of ["GET", "HEAD"]) assert.equal(allows("read", method), true);
  assert.equal(allows("hidden", "GET"), false);
  assert.equal(allows(undefined, "GET"), false);
});
