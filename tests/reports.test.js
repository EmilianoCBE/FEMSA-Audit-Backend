import assert from "node:assert/strict";
import { test } from "node:test";
import { parseReportFilters, getReport, reportIndicators } from "../services/reports.service.js";
import { reportQuery } from "../repositories/reports.repository.js";

const row = {
  recordId: 1,
  id: "H1",
  title: "Hallazgo",
  status: "abierto",
  severity: "Crítica",
  businessUnit: "Unidad",
  date: new Date("2026-10-01T00:00:00Z"),
  amount: 123.45,
};
const repository = {
  findReportIdentity: async () => ({ userId: 7, allRecords: false }),
  findReportRows: async () => [row],
};
test("REP-01 rechaza tipos filtros repetidos y fechas invalidas", () => {
  for (const query of [
    { kind: "__proto__" },
    { search: ["a", "b"] },
    { start: "2026-02-30" },
    { start: "2026-10-05", end: "2026-10-01" },
    { userId: "2" },
    { kind: "DROP TABLE" },
  ]) {
    assert.throws(
      () => parseReportFilters(query),
      (error) => error.status === 400,
    );
  }
});
test("REP-02 acepta texto como valor y no como SQL", () => {
  assert.equal(parseReportFilters({ search: "' OR 1=1 --" }).search, "' OR 1=1 --");
  const query = reportQuery("plans");
  assert.match(query, /@search/);
  assert.match(query, /@userId/);
  assert.match(query, /EXISTS/);
  assert.match(query, /SELECT MAX\(pp.progress_date\)/);
  assert.doesNotMatch(query, /JOIN dbo.PLAN_PROGRESS/);
});
test("REP-03 bloquea usuarios sin identidad de negocio", async () => {
  await assert.rejects(
    getReport({}, { id: "test" }, { ...repository, findReportIdentity: async () => null }),
    (error) => error.status === 403,
  );
});
test("REP-04 entrega numeros fechas y alcance sin datos de autenticacion", async () => {
  let received;
  const data = await getReport(
    { kind: "findings" },
    { id: "auth-id" },
    {
      ...repository,
      findReportIdentity: async (id) => {
        assert.equal(id, "auth-id");
        return { userId: 7, allRecords: false };
      },
      findReportRows: async (kind, filters, identity) => {
        received = identity;
        return [row];
      },
    },
  );
  assert.equal(received.allRecords, false);
  assert.equal(data.rows[0].date, "2026-10-01T00:00:00.000Z");
  assert.equal(data.rows[0].amount, 123.45);
  assert.equal(data.indicators.find((item) => item.id === "high").value, 1);
  assert.match(data.scope, /participas/);
  assert.equal(data.rows[0].userId, undefined);
});
test("REP-05 indicadores vacios cierres y planes vencidos", () => {
  assert.equal(reportIndicators([], "findings", new Date())[2].value, 0);
  const values = reportIndicators(
    [
      { status: "en_progreso", date: "2026-10-01", endDate: null, progress: 40 },
      { status: "concluido", date: "2026-09-01", endDate: "2026-09-01", progress: 100 },
    ],
    "plans",
    new Date("2026-10-25"),
  );
  assert.equal(values.find((item) => item.id === "overdue").value, 1);
  assert.equal(values.find((item) => item.id === "averageProgress").value, 70);
  assert.equal(values.find((item) => item.id === "closedPercent").value, 50);
});
test("REP-06 propaga errores de BD sin usar datos simulados", async () => {
  await assert.rejects(
    getReport(
      {},
      { id: "x" },
      {
        ...repository,
        findReportRows: async () => {
          throw new Error("BD no disponible");
        },
      },
    ),
    /BD no disponible/,
  );
});
test("REP-07 no devuelve resultados parciales al superar el limite", async () => {
  await assert.rejects(
    getReport({}, { id: "x" }, { ...repository, findReportRows: async () => Array(10001).fill(row) }),
    (error) => error.status === 422,
  );
});
