import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import sql from "mssql";

let server,
  base,
  originalConnect,
  allowIdentity = false,
  boundValues;
before(async () => {
  Object.assign(process.env, { DB_SERVER: "test", DB_NAME: "test", DB_USER: "test", DB_PASSWORD: "test" });
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
          if (query.includes("dbo.AuthSessions"))
            return {
              recordset: [
                { Id: "00000000-0000-4000-8000-000000000001", Name: "Usuario de prueba", Role: "Auditor", RoleId: 5 },
              ],
            };
          if (query.includes("WHERE au.Id"))
            return { recordset: allowIdentity ? [{ userId: 7, allRecords: false }] : [] };
          if (query.includes("SELECT TOP (10001)")) {
            boundValues = values;
            return {
              recordset: [
                {
                  recordId: 1,
                  id: "H1",
                  title: "Prueba",
                  status: "abierto",
                  severity: "Alta",
                  date: null,
                  amount: 100,
                },
              ],
            };
          }
          throw new Error("Consulta no esperada");
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
  base = `http://127.0.0.1:${server.address().port}/api/reports`;
});
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  const { closeDB } = await import("../db/db.js");
  await closeDB();
  sql.ConnectionPool.prototype.connect = originalConnect;
});
test("REP-08 HTTP sin sesion devuelve 401", async () => {
  const response = await fetch(base);
  assert.equal(response.status, 401);
});
test("REP-09 HTTP con sesion sin identidad permitida devuelve 403", async () => {
  const { SESSION_COOKIE } = await import("../utils/session.js");
  const response = await fetch(base, { headers: { Cookie: `${SESSION_COOKIE}=${"a".repeat(64)}` } });
  assert.equal(response.status, 403);
});

test("REP-20 HTTP con sesion valida devuelve datos y filtros parametrizados", async () => {
  allowIdentity = true;
  const search = "' OR 1=1 --";
  const response = await fetch(`${base}?kind=findings&search=${encodeURIComponent(search)}`, {
    headers: { Cookie: `femsa_session=${"a".repeat(64)}` },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.equal(body.rows[0].id, "H1");
  assert.equal(boundValues.search, search);
  assert.equal(boundValues.userId, 7);
  assert.equal(boundValues.allRecords, false);
});
test("REP-21 HTTP rechaza parametros para cambiar la identidad o un origen ajeno", async () => {
  const headers = { Cookie: `femsa_session=${"a".repeat(64)}` };
  assert.equal((await fetch(`${base}?userId=2`, { headers })).status, 400);
  assert.equal((await fetch(base, { headers: { ...headers, Origin: "https://otro-sitio.example" } })).status, 403);
});
