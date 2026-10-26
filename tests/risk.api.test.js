import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import sql from "mssql";
import { SESSION_COOKIE, tokenHash } from "../utils/session.js";

// US07: rutas de clasificación y biblioteca de riesgos. La BD se simula; el CI nunca se conecta a Azure.
const token = "e".repeat(64);
const session = { Id: "00000000-0000-4000-8000-000000000004", Name: "Ana Auditora", Role: "Auditor", RoleId: 1 };
const library = [
  { risk_library_id: "R-001", risk_name: "Fraude en compras", audit_department: "Compras", created_at: null },
  { risk_library_id: "R-002", risk_name: "Acceso indebido a sistemas", audit_department: "TI", created_at: null },
];
const headers = { Cookie: `${SESSION_COOKIE}=${token}`, "Content-Type": "application/json" };
const queries = [];

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
            return { recordset: values.hash === tokenHash(token) ? [session] : [] };
          }
          if (query.includes("FROM dbo.RISK_LIBRARY")) {
            queries.push({ ...values });
            if ("riskLibraryId" in values) {
              return { recordset: library.filter((risk) => risk.risk_library_id === values.riskLibraryId) };
            }
            return {
              recordset: library.filter((risk) => !values.department || risk.audit_department === values.department),
            };
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

const classify = (body, extra = {}) =>
  fetch(`${base}/risks/classify`, { method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify(body) });

test("US07 sin sesión no se clasifica ni se consulta la biblioteca", async () => {
  const response = await fetch(`${base}/risks/classify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ probability: 3, impact: 3 }),
  });
  assert.equal(response.status, 401);
  assert.equal((await fetch(`${base}/risk-library`)).status, 401);
});

test("US07.2 y US07.3 la API calcula el puntaje y asigna el nivel", async () => {
  const response = await classify({ probability: 4, impact: "5" });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual((await response.json()).result, { probability: 4, impact: 5, score: 20, level: "Crítico" });
});

test("US07.1 rechaza probabilidad o impacto fuera de 1 a 5 o no enteros", async () => {
  const cases = [
    [{ probability: 0, impact: 3 }, /probabilidad/],
    [{ probability: 6, impact: 3 }, /probabilidad/],
    [{ probability: 2.5, impact: 3 }, /probabilidad/],
    [{ impact: 3 }, /probabilidad/],
    [{ probability: 3, impact: 0 }, /impacto/],
    [{ probability: 3, impact: "alto" }, /impacto/],
  ];
  for (const [body, message] of cases) {
    const response = await classify(body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.match((await response.json()).msg, message);
  }
});

test("US07 rechaza clasificar desde otro origen", async () => {
  const response = await classify({ probability: 3, impact: 3 }, { Origin: "https://otro.example" });
  assert.equal(response.status, 403);
});

test("US07 la biblioteca lista los riesgos y filtra por búsqueda y área", async () => {
  queries.length = 0;
  const all = await (await fetch(`${base}/risk-library`, { headers })).json();
  assert.equal(all.count, 2);
  assert.deepEqual(queries.at(-1), { search: "%%", department: "" });

  const filtered = await (
    await fetch(`${base}/risk-library?search=%20fraude%20&department=Compras`, { headers })
  ).json();
  assert.equal(filtered.count, 1);
  assert.equal(filtered.risks[0].risk_library_id, "R-001");
  assert.deepEqual(queries.at(-1), { search: "%fraude%", department: "Compras" });
});

test("US07 la biblioteca regresa un riesgo por id o 404 si no existe", async () => {
  const found = await fetch(`${base}/risk-library/R-002`, { headers });
  assert.equal(found.status, 200);
  assert.equal((await found.json()).risk.risk_name, "Acceso indebido a sistemas");

  const missing = await fetch(`${base}/risk-library/R-999`, { headers });
  assert.equal(missing.status, 404);
  assert.match((await missing.json()).message, /No se encontró/);
});
