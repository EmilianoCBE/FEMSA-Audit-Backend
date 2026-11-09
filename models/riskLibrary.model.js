import { getPool, sql } from "../db/db.js";

/**
 * Consulta los riesgos registrados en la biblioteca de FEMSA.
 */
export async function findRiskLibrary({ search = "", department = "" } = {}) {
  const pool = await getPool();

  const request = pool
    .request()
    .input("search", sql.NVarChar(600), `%${search.trim()}%`)
    .input("department", sql.NVarChar(200), department.trim());

  const result = await request.query(`
    SELECT
      risk_library_id,
      risk_name,
      audit_department,
      created_at
    FROM dbo.RISK_LIBRARY
    WHERE
      (
        @search = '%%'
        OR risk_library_id LIKE @search
        OR risk_name LIKE @search
      )
      AND (
        @department = ''
        OR audit_department = @department
      )
    ORDER BY risk_name ASC;
  `);

  return result.recordset;
}

/**
 * Consulta un riesgo específico por su identificador de biblioteca.
 */
export async function findRiskLibraryById(riskLibraryId) {
  const pool = await getPool();

  const result = await pool
    .request()
    .input("riskLibraryId", sql.VarChar(30), riskLibraryId)
    .query(`
      SELECT
        risk_library_id,
        risk_name,
        audit_department,
        created_at
      FROM dbo.RISK_LIBRARY
      WHERE risk_library_id = @riskLibraryId;
    `);

  return result.recordset[0] ?? null;
}

export async function findRiskLibraryRegisterDetails(riskLibraryId) {
  const pool = await getPool();

  const result = await pool
    .request()
    .input("riskLibraryId", sql.VarChar(30), riskLibraryId)
    .query(`
      SELECT
        rl.risk_library_id,
        rl.risk_name,
        rl.audit_department,

        r.risk_id,
        r.tracking_id,
        r.name AS risk_register_name,
        r.category AS risk_category,
        r.inherent_level AS risk_inherent_level,

        c.control_id,
        c.tracking_id AS control_tracking_id,
        c.name AS control_name,
        c.domain AS control_domain,

        latest.evaluation_id,
        latest.probability,
        latest.impact,
        latest.inherent_level AS evaluation_inherent_level,
        latest.design_rating,
        latest.effectiveness_rating,
        latest.control_level,
        latest.vulnerability,
        latest.evaluated_at,
        latest.comments,
        evaluator.full_name AS evaluator_name

      FROM dbo.RISK_LIBRARY rl

      LEFT JOIN dbo.RISK_LIBRARY_RISK_REGISTER rr
        ON rr.risk_library_id = rl.risk_library_id

      LEFT JOIN dbo.RISK r
        ON r.risk_id = rr.risk_id

      LEFT JOIN dbo.CONTROL c
        ON c.risk_id = r.risk_id

      OUTER APPLY (
        SELECT TOP 1
          ce.evaluation_id,
          ce.probability,
          ce.impact,
          ce.inherent_level,
          ce.design_rating,
          ce.effectiveness_rating,
          ce.control_level,
          ce.vulnerability,
          ce.evaluated_at,
          ce.comments,
          ce.evaluated_by_user_id
        FROM dbo.CONTROL_EVALUATION ce
        WHERE ce.control_id = c.control_id
        ORDER BY ce.evaluated_at DESC, ce.evaluation_id DESC
      ) latest

      LEFT JOIN dbo.[USER] evaluator
        ON evaluator.user_id = latest.evaluated_by_user_id

      WHERE rl.risk_library_id = @riskLibraryId

      ORDER BY
        r.tracking_id,
        c.tracking_id,
        c.control_id;
    `);

  return result.recordset;
}

export async function findRiskLibraryRisks(riskLibraryId) {
  const pool = await getPool();

  const result = await pool
    .request()
    .input("riskLibraryId", sql.VarChar(30), riskLibraryId)
    .query(`
      SELECT
        r.risk_id,
        r.tracking_id,
        r.name,
        r.category,
        r.inherent_level
      FROM dbo.RISK_LIBRARY_RISK_REGISTER AS rlrr
      INNER JOIN dbo.RISK AS r
        ON r.risk_id = rlrr.risk_id
      WHERE rlrr.risk_library_id = @riskLibraryId
      ORDER BY r.name ASC;
    `);

  return result.recordset;
}
