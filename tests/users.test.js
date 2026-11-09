import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import sql from "mssql";
import { SESSION_COOKIE, tokenHash } from "../utils/session.js";

// US02: la BD se simula solo para la sesión. Hay dos sesiones: administrador (role_id 2) y visualizador (3).
// Las pruebas cubren permisos y validaciones, que el backend revisa antes de tocar la BD.
const adminToken = "c".repeat(64);
const viewerToken = "d".repeat(64);
const sessions = new Map([
  [
    tokenHash(adminToken),
    { Id: "00000000-0000-4000-8000-000000000002", Name: "Ada Admin", Role: "Administrador", RoleId: 2 },
  ],
  [
    tokenHash(viewerToken),
    { Id: "00000000-0000-4000-8000-000000000003", Name: "Vic Viewer", Role: "Visualizador", RoleId: 3 },
  ],
]);
const as = (token) => ({ Cookie: `${SESSION_COOKIE}=${token}`, "Content-Type": "application/json" });
const validUser = { firstName: "Daniela", lastName: "Aedo", role_id: 3, password: "contraseña-segura" };

let server;
let base;
let originalConnect;

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
            const user = sessions.get(values.hash);
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
  base = `http://127.0.0.1:${server.address().port}/api/users`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  sql.ConnectionPool.prototype.connect = originalConnect;
  const { closeDB } = await import("../db/db.js");
  await closeDB();
});

const createUser = (body, token = adminToken) =>
  fetch(base, { method: "POST", headers: as(token), body: JSON.stringify(body) });

test("US02 sin sesión no se consultan usuarios", async () => {
  assert.equal((await fetch(base)).status, 401);
  assert.equal((await fetch(`${base}/roles`)).status, 401);
});

test("US02.4 un usuario que no es administrador recibe 403 en todo el módulo", async () => {
  const requests = [
    fetch(base, { headers: as(viewerToken) }),
    fetch(`${base}/roles`, { headers: as(viewerToken) }),
    createUser(validUser, viewerToken),
    fetch(`${base}/5/role`, { method: "PUT", headers: as(viewerToken), body: JSON.stringify({ role_id: 2 }) }),
  ];
  for (const response of await Promise.all(requests)) {
    assert.equal(response.status, 403);
    assert.match((await response.json()).msg, /permisos/);
  }
});

test("US02.2 valida los ids al cambiar de rol", async () => {
  const put = (id, body) =>
    fetch(`${base}/${id}/role`, { method: "PUT", headers: as(adminToken), body: JSON.stringify(body) });
  assert.equal((await put("abc", { role_id: 2 })).status, 400);
  assert.equal((await put(0, { role_id: 2 })).status, 400);
  assert.equal((await put(5, { role_id: "admin" })).status, 400);
  assert.equal((await put(5, {})).status, 400);
});

test("US02 valida el alta de usuario antes de guardar", async () => {
  const cases = [
    [{ ...validUser, firstName: " " }, /nombre/],
    [{ ...validUser, lastName: 42 }, /nombre/],
    [{ ...validUser, firstName: "<script>" }, /no es válido/],
    [{ ...validUser, firstName: "a".repeat(101) }, /no es válido/],
    [{ ...validUser, role_id: 0 }, /rol válido/],
    [{ ...validUser, password: "corta" }, /9 caracteres/],
    [{ ...validUser, password: "x".repeat(1025) }, /9 caracteres/],
    [{ ...validUser, firstName: "***", lastName: "Aedo" }, /correo corporativo/],
  ];
  for (const [body, message] of cases) {
    const response = await createUser(body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.match((await response.json()).msg, message);
  }
});

test("US02 rechaza el alta desde otro origen", async () => {
  const response = await fetch(base, {
    method: "POST",
    headers: { ...as(adminToken), Origin: "https://otro.example" },
    body: JSON.stringify(validUser),
  });
  assert.equal(response.status, 403);
});
