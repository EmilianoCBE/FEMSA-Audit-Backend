import { getPool, sql } from "../db/db.js";

export const REPORT_SOURCES = {
  audits: {
    from: "dbo.AUDIT a",
    columns:
      "a.audit_id AS recordId, a.tracking_id AS id, a.name AS title, a.name AS auditName, a.state AS status, a.priority AS severity, a.start_date AS date, a.end_date AS endDate, NULL AS progress, NULL AS amount, NULL AS lastProgress",
    owner: "a.user_id",
    date: "a.start_date",
    severity: "a.priority",
    status: "a.state",
    tables: ["AUDIT", "BUSINESS_UNIT", "USER"],
  },
  findings: {
    from: "dbo.FINDING f INNER JOIN dbo.AUDIT a ON a.audit_id = f.audit_id",
    columns:
      "f.finding_id AS recordId, f.tracking_id AS id, f.title, a.name AS auditName, f.state AS status, f.severity, f.identified_at AS date, NULL AS endDate, NULL AS progress, f.impact_mxn AS amount, NULL AS lastProgress",
    owner: "f.responsible_id",
    date: "f.identified_at",
    severity: "f.severity",
    status: "f.state",
    tables: ["FINDING", "AUDIT", "BUSINESS_UNIT", "USER"],
  },
  plans: {
    from: "dbo.REMEDIATION_PLAN p INNER JOIN dbo.FINDING f ON f.finding_id = p.finding_id INNER JOIN dbo.AUDIT a ON a.audit_id = f.audit_id",
    columns:
      "p.remediation_plan_id AS recordId, p.tracking_id AS id, p.description AS title, a.name AS auditName, p.state AS status, f.severity, p.due_date AS date, p.concluded_at AS endDate, p.progress_pct AS progress, p.amount_mxn AS amount, (SELECT MAX(pp.progress_date) FROM dbo.PLAN_PROGRESS pp WHERE pp.remediation_plan_id = p.remediation_plan_id) AS lastProgress",
    owner: "p.responsible_id",
    date: "p.due_date",
    severity: "f.severity",
    status: "p.state",
    tables: ["REMEDIATION_PLAN", "FINDING", "AUDIT", "BUSINESS_UNIT", "USER", "PLAN_PROGRESS"],
  },
};

export async function findReportIdentity(authId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("authId", sql.UniqueIdentifier, authId)
    .query(`
    SELECT u.user_id AS userId,
      CAST(CASE WHEN r.role_id = 2 OR r.code = 'admin' THEN 1 ELSE 0 END AS bit) AS allRecords
    FROM dbo.AuthUsers au
    INNER JOIN dbo.[USER] u ON u.user_id = au.UserId
    INNER JOIN dbo.ROLE r ON r.role_id = u.role_id
    WHERE au.Id = @authId AND au.IsActive = 1 AND u.is_active = 1
  `);
  return result.recordset[0];
}

// Los nombres SQL salen de esta lista fija y los filtros siempre van como parametros
export function reportQuery(kind) {
  const source = REPORT_SOURCES[kind];
  if (!source) throw new Error("Tipo de reporte no permitido");
  return `SELECT TOP (10001) ${source.columns}, bu.unity AS businessUnit, u.full_name AS responsible
    FROM ${source.from}
    LEFT JOIN dbo.BUSINESS_UNIT bu ON bu.business_unit_id = a.business_unit_id
    LEFT JOIN dbo.[USER] u ON u.user_id = ${source.owner}
    WHERE (@allRecords = 1 OR a.user_id = @userId OR ${source.owner} = @userId
      OR EXISTS (SELECT 1 FROM dbo.AUDIT_PARTICIPANT ap WHERE ap.audit_id = a.audit_id AND ap.user_id = @userId))
    AND (@businessUnit = N'' OR bu.unity = @businessUnit)
    AND (@status = N'' OR ${source.status} = @status)
    AND (@severity = N'' OR ${source.severity} = @severity)
    AND (@start = '' OR ${source.date} >= CONVERT(date, NULLIF(@start, ''), 23))
    AND (@end = '' OR ${source.date} < DATEADD(day, 1, CONVERT(date, NULLIF(@end, ''), 23)))
    AND (@search = N'' OR CHARINDEX(@search, COALESCE(CAST((${kind === "audits" ? "a.name" : kind === "findings" ? "f.title" : "p.description"}) AS nvarchar(max)), N'')) > 0
      OR CHARINDEX(@search, COALESCE(a.name, N'')) > 0
      OR CHARINDEX(@search, COALESCE(${kind === "audits" ? "a" : kind === "findings" ? "f" : "p"}.tracking_id, N'')) > 0)
    ORDER BY recordId`;
}

export async function findReportRows(kind, filters, identity) {
  const pool = await getPool();
  const request = pool
    .request()
    .input("userId", sql.Int, identity.userId)
    .input("allRecords", sql.Bit, identity.allRecords);
  for (const key of ["search", "businessUnit", "status", "severity"])
    request.input(key, sql.NVarChar(key === "search" ? 150 : 200), filters[key]);
  for (const key of ["start", "end"]) request.input(key, sql.VarChar(10), filters[key]);
  return (await request.query(reportQuery(kind))).recordset;
}
