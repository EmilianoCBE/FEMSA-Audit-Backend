import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import sql from "mssql";
import { SESSION_COOKIE, tokenHash } from "../utils/session.js";

// US02: flujo completo de usuarios con la BD simulada en memoria (tablas USER, ROLE y AuthUsers).
// Complementa users.test.js, que cubre permisos y validaciones antes de tocar la BD.
const adminToken = "f".repeat(64);
const admin = { Id: "00000000-0000-4000-8000-000000000002", Name: "Ada Admin", Role: "Administrador", RoleId: 2 };
const headers = {
  Cookie: `${SESSION_COOKIE}=${adminToken}`,
  "Content-Type": "application/json",
};
const roles = [
  { role_id: 1, name: "Auditor", description: "Realiza auditorías" },
  { role_id: 2, name: "Administrador", description: "Administra usuarios" },
  { role_id: 3, name: "Visualizador", description: "Solo consulta" },
];

let users;
let authUsers;
let transactions;

/** Responde las consultas del modelo de usuarios sobre las tablas en memoria. */
function runQuery(query, values) {
  if (query.includes("FROM dbo.AuthSessions")) {
    return { recordset: values.hash === tokenHash(adminToken) ? [admin] : [] };
  }
  if (query.includes("INNER JOIN dbo.[ROLE]")) {
    const list = users.map((user) => {
      const role = roles.find((item) => item.role_id === user.role_id);
      return { ...user, role_name: role.name, role_description: role.description };
    });
    return { recordset: list.sort((a, b) => a.full_name.localeCompare(b.full_name)) };
  }
  if (query.includes("COUNT(*) AS activeAdmins")) {
    return { recordset: [{ activeAdmins: users.filter((user) => user.role_id === 2 && user.is_active).length }] };
  }
  if (query.includes("FROM dbo.[ROLE]")) {
    if ("roleId" in values) return { recordset: roles.filter((role) => role.role_id === values.roleId) };
    return { recordset: [...roles].sort((a, b) => a.name.localeCompare(b.name)) };
  }
  if (query.includes("AS emailExists")) {
    const exists =
      users.some((user) => user.email === values.email) ||
      authUsers.some((auth) => auth.Email === values.email || auth.Username === values.email);
    return { recordset: [{ emailExists: exists ? 1 : 0 }] };
  }
  if (query.includes("INSERT INTO dbo.[USER]")) {
    const user = {
      user_id: users.length + 1,
      email: values.email,
      full_name: values.fullName,
      is_active: true,
      created_at: new Date(0),
      role_id: values.roleId,
    };
    users.push(user);
    return { recordset: [user] };
  }
  if (query.includes("INSERT INTO dbo.AuthUsers")) {
    authUsers.push({ Username: values.username, Email: values.email, PasswordHash: values.passwordHash });
    return { recordset: [] };
  }
  if (query.includes("SELECT user_id, role_id, is_active")) {
    return { recordset: users.filter((user) => user.user_id === values.userId) };
  }
  if (query.includes("UPDATE dbo.[USER]")) {
    const user = users.find((item) => item.user_id === values.userId);
    user.role_id = values.roleId;
    return {
      recordset: [{ user_id: user.user_id, email: user.email, full_name: user.full_name, role_id: user.role_id }],
    };
  }
  throw new Error(`Unexpected SQL: ${query}`);
}

const fakeRequest = () => {
  const values = {};
  return {
    input(name, type, value) {
      values[name] = value;
      return this;
    },
    async query(query) {
      return runQuery(query, values);
    },
  };
};

let server;
let base;
const originals = {};

before(async () => {
  Object.assign(process.env, {
    DB_SERVER: "test",
    DB_NAME: "test",
    DB_USER: "test",
    DB_PASSWORD: "test",
    WEB_ORIGIN: "http://127.0.0.1:5173",
  });
  originals.connect = sql.ConnectionPool.prototype.connect;
  originals.begin = sql.Transaction.prototype.begin;
  originals.commit = sql.Transaction.prototype.commit;
  originals.rollback = sql.Transaction.prototype.rollback;
  originals.input = sql.Request.prototype.input;
  originals.query = sql.Request.prototype.query;

  sql.ConnectionPool.prototype.connect = async () => ({ close: async () => {}, request: fakeRequest });
  // Las transacciones del modelo usan `new sql.Request(transaction)`: se simulan sobre las mismas tablas.
  sql.Transaction.prototype.begin = async function () {
    transactions.push("begin");
    return this;
  };
  sql.Transaction.prototype.commit = async () => transactions.push("commit");
  sql.Transaction.prototype.rollback = async () => transactions.push("rollback");
  sql.Request.prototype.input = function (name, type, value) {
    this.fakeValues = { ...this.fakeValues, [name]: value };
    return this;
  };
  sql.Request.prototype.query = async function (query) {
    return runQuery(query, this.fakeValues ?? {});
  };

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
  sql.ConnectionPool.prototype.connect = originals.connect;
  sql.Transaction.prototype.begin = originals.begin;
  sql.Transaction.prototype.commit = originals.commit;
  sql.Transaction.prototype.rollback = originals.rollback;
  sql.Request.prototype.input = originals.input;
  sql.Request.prototype.query = originals.query;
  const { closeDB } = await import("../db/db.js");
  await closeDB();
});

beforeEach(() => {
  users = [
    { user_id: 1, entra_id: null, email: "ada.admin@femsa.com", full_name: "Ada Admin", is_active: true, role_id: 2 },
    { user_id: 2, entra_id: null, email: "beto.ruiz@femsa.com", full_name: "Beto Ruiz", is_active: true, role_id: 1 },
  ];
  authUsers = [{ Username: "ada.admin@femsa.com", Email: "ada.admin@femsa.com" }];
  transactions = [];
});

const createUser = (body) => fetch(base, { method: "POST", headers, body: JSON.stringify(body) });
const changeRole = (id, roleId) =>
  fetch(`${base}/${id}/role`, { method: "PUT", headers, body: JSON.stringify({ role_id: roleId }) });

test("US02.1 el administrador consulta los usuarios con su rol y los roles disponibles", async () => {
  const list = await (await fetch(base, { headers })).json();
  assert.deepEqual(
    list.users.map((user) => [user.full_name, user.role_name]),
    [
      ["Ada Admin", "Administrador"],
      ["Beto Ruiz", "Auditor"],
    ],
  );
  const { roles: available } = await (await fetch(`${base}/roles`, { headers })).json();
  assert.deepEqual(
    available.map((role) => role.name),
    ["Administrador", "Auditor", "Visualizador"],
  );
});

test("US02 alta de usuario: genera el correo corporativo y guarda solo el hash de la contraseña", async () => {
  const response = await createUser({
    firstName: "José Luis",
    lastName: "Peña Gómez",
    role_id: 3,
    password: "Temporal123!",
  });
  assert.equal(response.status, 201);
  const { user } = await response.json();
  assert.equal(user.email, "jose.pena@femsa.com");
  assert.equal(user.full_name, "José Luis Peña Gómez");
  assert.equal(user.role_id, 3);
  const credentials = authUsers.find((auth) => auth.Email === "jose.pena@femsa.com");
  assert.ok(credentials.PasswordHash);
  assert.notEqual(credentials.PasswordHash, "Temporal123!");
  assert.deepEqual(transactions, ["begin", "commit"]);
});

test("US02 si el correo ya existe agrega un número al final", async () => {
  users.push({ user_id: 3, email: "ana.lopez@femsa.com", full_name: "Ana López", is_active: true, role_id: 1 });
  authUsers.push({ Username: "ana.lopez2@femsa.com", Email: "ana.lopez2@femsa.com" });
  const { user } = await (
    await createUser({ firstName: "Ana", lastName: "López", role_id: 1, password: "Temporal123!" })
  ).json();
  assert.equal(user.email, "ana.lopez3@femsa.com");
});

test("US02 no crea el usuario si el rol no existe y revierte la transacción", async () => {
  const response = await createUser({ firstName: "Eva", lastName: "Mora", role_id: 99, password: "Temporal123!" });
  assert.equal(response.status, 400);
  assert.match((await response.json()).msg, /rol seleccionado no existe/);
  assert.deepEqual(transactions, ["begin", "rollback"]);
  assert.equal(users.length, 2);
});

test("US02.2 asigna un rol nuevo a un usuario", async () => {
  const response = await changeRole(2, 3);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.user.role_id, 3);
  assert.match(body.message, /Rol asignado/);
  assert.equal(users[1].role_id, 3);
  assert.deepEqual(transactions, ["begin", "commit"]);
});

test("US02.2 responde 404 si el usuario o el rol no existen", async () => {
  assert.equal((await changeRole(2, 99)).status, 404);
  assert.equal((await changeRole(99, 1)).status, 404);
});

test("US02.3 no se puede quitar el rol al último administrador activo", async () => {
  const response = await changeRole(1, 1);
  assert.equal(response.status, 409);
  assert.match((await response.json()).msg, /último administrador/);
  assert.equal(users[0].role_id, 2);
  assert.ok(transactions.includes("rollback"));

  users.push({ user_id: 3, email: "otra.admin@femsa.com", full_name: "Otra Admin", is_active: true, role_id: 2 });
  assert.equal((await changeRole(1, 1)).status, 200);
});
