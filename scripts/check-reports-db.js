import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { getPool, closeDB, sql } from "../db/db.js";
import { getReport } from "../services/reports.service.js";

// Solo hacemos consultas de lectura y guardamos evidencia sin nombres ni credenciales
const directory = resolve(process.argv[2] || "../FEMSA-Audit/evidencia/reportes");
await mkdir(directory, { recursive: true });
const results = [];
const queries = [];
const samples = [];
try {
  const pool = await getPool();
  const users = await pool.request().query(`SELECT au.Id, u.user_id AS userId,
    CASE WHEN r.role_id = 2 OR r.code = 'admin' THEN 1 ELSE 0 END AS allRecords
    FROM dbo.AuthUsers au JOIN dbo.[USER] u ON u.user_id=au.UserId JOIN dbo.ROLE r ON r.role_id=u.role_id
    WHERE au.IsActive=1 AND u.is_active=1`);
  const admin = users.recordset.find((user) => user.allRecords);
  const limited = users.recordset.find((user) => !user.allRecords);
  if (!admin) throw new Error("Se necesita una identidad administradora existente para comparar totales");
  const sources = {
    audits: { from: "dbo.AUDIT a", owner: "a.user_id", id: "a.audit_id", state: "a.state", date: "a.start_date" },
    findings: {
      from: "dbo.FINDING f JOIN dbo.AUDIT a ON a.audit_id=f.audit_id",
      owner: "f.responsible_id",
      id: "f.finding_id",
      state: "f.state",
      date: "f.identified_at",
    },
    plans: {
      from: "dbo.REMEDIATION_PLAN p JOIN dbo.FINDING f ON f.finding_id=p.finding_id JOIN dbo.AUDIT a ON a.audit_id=f.audit_id",
      owner: "p.responsible_id",
      id: "p.remediation_plan_id",
      state: "p.state",
      date: "p.due_date",
    },
  };
  for (const [kind, source] of Object.entries(sources)) {
    for (const [scope, identity] of [
      ["administrador", admin],
      ["usuario limitado", limited],
    ]) {
      if (!identity) {
        results.push({ kind, scope, result: "NO EJECUTADO sin identidad disponible" });
        continue;
      }
      const access =
        scope === "administrador"
          ? "1=1"
          : `(a.user_id=@userId OR ${source.owner}=@userId OR EXISTS (SELECT 1 FROM dbo.AUDIT_PARTICIPANT ap WHERE ap.audit_id=a.audit_id AND ap.user_id=@userId))`;
      for (const filtered of [false, true]) {
        const query = `SELECT ${source.id} AS recordId, ${source.state} AS state FROM ${source.from} WHERE ${access}${filtered ? ` AND ${source.state}=@state` : ""} ORDER BY ${source.id}`;
        const data = await getReport({ kind }, { id: identity.Id });
        const state = data.rows[0]?.status || "estado_sin_registros";
        const report = filtered ? await getReport({ kind, status: state }, { id: identity.Id }) : data;
        const request = pool
          .request()
          .input("userId", sql.Int, identity.userId)
          .input("state", sql.NVarChar(200), state);
        const expected = (await request.query(query)).recordset;
        assert.deepEqual(
          report.rows.map((row) => row.recordId),
          expected.map((row) => row.recordId),
        );
        const closed = expected.filter((row) =>
          ["cerrado", "cerrada", "concluido", "concluida", "closed", "completado", "completada"].includes(
            row.state.toLowerCase(),
          ),
        ).length;
        assert.equal(report.indicators.find((item) => item.id === "open").value, expected.length - closed);
        assert.equal(new Set(report.rows.map((row) => row.recordId)).size, report.rows.length);
        const closedSql = `LOWER(${source.state}) IN ('cerrado','cerrada','concluido','concluida','closed','completado','completada')`;
        const extraMetrics =
          kind === "findings"
            ? `, SUM(CASE WHEN NOT (${closedSql}) AND LOWER(f.severity) COLLATE Latin1_General_CI_AI IN ('alta','critica','high','critical') THEN 1 ELSE 0 END) AS high`
            : kind === "plans"
              ? `, SUM(CASE WHEN NOT (${closedSql}) AND p.concluded_at IS NULL AND p.due_date < @now THEN 1 ELSE 0 END) AS overdue, AVG(CAST(p.progress_pct AS float)) AS averageProgress`
              : "";
        const metricQuery = `SELECT COUNT(*) AS total, SUM(CASE WHEN ${closedSql} THEN 1 ELSE 0 END) AS closed ${extraMetrics} FROM ${source.from} WHERE ${access}${filtered ? ` AND ${source.state}=@state` : ""}`;
        const metricRequest = pool
          .request()
          .input("userId", sql.Int, identity.userId)
          .input("state", sql.NVarChar(200), state)
          .input("now", sql.DateTime2, new Date(report.queriedAt));
        const metric = (await metricRequest.query(metricQuery)).recordset[0];
        const expectedMetrics = {
          total: metric.total,
          open: metric.total - (metric.closed || 0),
          closedPercent: metric.total ? ((metric.closed || 0) / metric.total) * 100 : 0,
          high: metric.high || 0,
          overdue: metric.overdue || 0,
          averageProgress: metric.averageProgress || 0,
        };
        for (const indicator of report.indicators)
          assert.ok(
            Math.abs(indicator.value - expectedMetrics[indicator.id]) < 0.000001,
            `Indicador diferente ${kind} ${indicator.id}`,
          );
        queries.push(metricQuery);

        results.push({
          kind,
          scope,
          filter: filtered ? { status: state } : {},
          sqlRows: expected.length,
          apiServiceRows: report.rows.length,
          unique: true,
          indicatorsMatchSql: true,
          result: "APROBADO",
        });
        queries.push(
          `-- ${kind} ${scope} ${filtered ? "por estado" : "sin filtros"}\n${query}\n-- @userId se obtiene de la identidad de prueba y no se guarda en evidencia\n-- @state = ${JSON.stringify(state)}\n`,
        );
        if (scope === "administrador" && !filtered) {
          const safeFields = report.fields.filter((field) =>
            ["id", "status", "severity", "date", "endDate", "progress", "amount", "lastProgress"].includes(field.id),
          );
          samples.push({
            ...report,
            fields: safeFields,
            rows: report.rows.map((row) => Object.fromEntries(safeFields.map((field) => [field.id, row[field.id]]))),
          });
        }
      }
    }
    const noResults = await getReport({ kind, search: "' OR 1=1 --" }, { id: admin.Id });
    assert.equal(noResults.rows.length, 0);
    results.push({ kind, test: "Busqueda con texto SQL no altera la consulta", result: "APROBADO" });
    const query = `SELECT COUNT(*) AS total FROM ${source.from} WHERE ${source.date} >= '2026-10-01' AND ${source.date} < '2026-11-01'`;
    const expected = (await pool.request().query(query)).recordset[0].total;
    const report = await getReport({ kind, start: "2026-10-01", end: "2026-10-31" }, { id: admin.Id });
    assert.equal(report.rows.length, expected);
    results.push({
      kind,
      test: "Periodo octubre 2026",
      sqlRows: expected,
      apiServiceRows: report.rows.length,
      result: "APROBADO",
    });
    queries.push(query);
  }
  const evidence = {
    executedAt: new Date().toISOString(),
    database: "E12_FEMSA",
    mode: "Solo lectura sin cambios de datos ni sesiones",
    method:
      "Servicio real de API getReport y repositorio SQL comparados con SELECT independientes No es una sesion HTTP del navegador",
    note: "Los registros estan almacenados en SQL Su origen operativo o de pruebas no fue certificado",
    results,
  };
  await writeFile(resolve(directory, "comparacion-bd.json"), JSON.stringify(evidence, null, 2));
  await writeFile(resolve(directory, "consultas-verificacion.sql"), queries.join("\n\n"));
  await writeFile(resolve(directory, "datos-exportacion.json"), JSON.stringify(samples, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await closeDB();
}
