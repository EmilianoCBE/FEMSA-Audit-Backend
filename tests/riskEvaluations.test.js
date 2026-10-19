import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import sql from "mssql";
import { SESSION_COOKIE, tokenHash } from "../utils/session.js";

// US07: la BD se simula. Solo responde la sesión y la consulta de la biblioteca de riesgos;
// las pruebas cubren lo que el backend valida antes de guardar.
const token = "b".repeat(64);
const sessionUser = { Id: "00000000-0000-4000-8000-000000000007", Name: "Karla Prueba", Role: "Auditor", RoleId: 3 };
const headers = { Cookie: `${SESSION_COOKIE}=${token}`, "Content-Type": "application/json" };
const knownRisk = { risk_library_id: "R-001", risk_name: "Acceso no autorizado", audit_department: "Beverage" };

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
            return { recordset: values.hash === tokenHash(token) ? [sessionUser] : [] };
          }
          if (query.includes("FROM dbo.RISK_LIBRARY") && "riskLibraryId" in values) {
            return { recordset: values.riskLibraryId === knownRisk.risk_library_id ? [knownRisk] : [] };
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
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  sql.ConnectionPool.prototype.connect = originalConnect;
  const { closeDB } = await import("../db/db.js");
  await closeDB();
});

const save = (body, extra = headers) =>
  fetch(`${base}/risk-evaluations`, { method: "POST", headers: extra, body: JSON.stringify(body) });

test("US07 las evaluaciones y la biblioteca piden sesión", async () => {
  assert.equal((await fetch(`${base}/risk-evaluations`)).status, 401);
  assert.equal((await fetch(`${base}/risk-library`)).status, 401);
  assert.equal(
    (await save({ riskLibraryId: "R-001", probability: 3, impact: 3 }, { "Content-Type": "application/json" })).status,
    401,
  );
});

test("US07.1 valida riesgo, probabilidad e impacto antes de guardar", async () => {
  const cases = [
    [{ probability: 3, impact: 3 }, /riesgo del catálogo/],
    [{ riskLibraryId: "  ", probability: 3, impact: 3 }, /riesgo del catálogo/],
    [{ riskLibraryId: "R-001", probability: 0, impact: 3 }, /probabilidad/],
    [{ riskLibraryId: "R-001", probability: 6, impact: 3 }, /probabilidad/],
    [{ riskLibraryId: "R-001", probability: 2.5, impact: 3 }, /probabilidad/],
    [{ riskLibraryId: "R-001", probability: 3, impact: "alto" }, /impacto/],
  ];
  for (const [body, message] of cases) {
    const response = await save(body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.match((await response.json()).msg, message);
  }
});

test("US07 responde 404 si el riesgo no existe en la biblioteca", async () => {
  const response = await save({ riskLibraryId: "R-999", probability: 3, impact: 3 });
  assert.equal(response.status, 404);
});

test("US07 rechaza filtros inválidos del historial", async () => {
  assert.equal((await fetch(`${base}/risk-evaluations?level=Altísimo`, { headers })).status, 400);
  assert.equal((await fetch(`${base}/risk-evaluations?search=${"x".repeat(201)}`, { headers })).status, 400);
});
