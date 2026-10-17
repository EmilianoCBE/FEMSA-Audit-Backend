
import { getPool, sql } from '../db/db.js';

export async function createRiskEvaluation({
  riskLibraryId,
  probability,
  impact,
  score,
  level,
  authUserId,
}) {
  const pool = await getPool();

  const result = await pool
    .request()
    .input('riskLibraryId', sql.VarChar(30), riskLibraryId)
    .input('probability', sql.TinyInt, probability)
    .input('impact', sql.TinyInt, impact)
    .input('score', sql.Int, score)
    .input('level', sql.NVarChar(20), level)
    .input('authUserId', sql.UniqueIdentifier, authUserId)
    .query(`
      INSERT INTO dbo.RISK_EVALUATION (
        risk_library_id,
        probability,
        impact,
        risk_score,
        risk_level,
        evaluated_by_user_id
      )
      OUTPUT
        inserted.evaluation_id,
        inserted.risk_library_id,
        inserted.probability,
        inserted.impact,
        inserted.risk_score,
        inserted.risk_level,
        inserted.evaluated_by_user_id,
        inserted.created_at
      SELECT
        rl.risk_library_id,
        @probability,
        @impact,
        @score,
        @level,
        u.user_id
      FROM dbo.RISK_LIBRARY AS rl
      INNER JOIN dbo.AuthUsers AS a
        ON a.Id = @authUserId
      INNER JOIN dbo.[USER] AS u
        ON u.user_id = a.UserId
      WHERE rl.risk_library_id = @riskLibraryId
        AND a.IsActive = 1
        AND u.is_active = 1;
    `);

  return result.recordset[0] ?? null;

}
export async function getRecentRiskEvaluations(limit = 5) {
  const pool = await getPool();

  const result = await pool
    .request()
    .input('limit', sql.Int, limit)
    .query(`
      SELECT TOP (@limit)
        e.evaluation_id,
        e.risk_library_id,
        rl.risk_name,
        rl.audit_department,
        e.probability,
        e.impact,
        e.risk_score,
        e.risk_level,
        e.evaluated_by_user_id,
        u.full_name AS evaluated_by_name,
        e.created_at
      FROM dbo.RISK_EVALUATION AS e
      INNER JOIN dbo.RISK_LIBRARY AS rl
        ON rl.risk_library_id = e.risk_library_id
      LEFT JOIN dbo.[USER] AS u
        ON u.user_id = e.evaluated_by_user_id
      ORDER BY
        e.created_at DESC,
        e.evaluation_id DESC;
    `);

  return result.recordset;
}


export async function getRiskEvaluations({
  search = "",
  department = "",
  level = "",
  fromDate = null,
  toDate = null,
  page = 1,
  pageSize = 10,
} = {}) {
  const pool = await getPool();

  const request = pool.request()
    .input("search", sql.NVarChar(200), `%${search}%`)
    .input("department", sql.NVarChar(100), department || null)
    .input("level", sql.NVarChar(20), level || null)
    .input("fromDate", sql.DateTime2, fromDate)
    .input("toDate", sql.DateTime2, toDate)
    .input("offset", sql.Int, (page - 1) * pageSize)
    .input("pageSize", sql.Int, pageSize);

  const filters = `
    (@search = '%%'
      OR rl.risk_name LIKE @search
      OR rl.risk_library_id LIKE @search)
    AND (@department IS NULL
      OR rl.audit_department = @department)
    AND (@level IS NULL
      OR e.risk_level = @level)
    AND (@fromDate IS NULL
      OR e.created_at >= @fromDate)
    AND (@toDate IS NULL
      OR e.created_at < @toDate)
  `;

  const result = await request.query(`
    SELECT
      e.evaluation_id,
      e.risk_library_id,
      rl.risk_name,
      rl.audit_department,
      e.probability,
      e.impact,
      e.risk_score,
      e.risk_level,
      e.evaluated_by_user_id,
      u.full_name AS evaluated_by_name,
      e.created_at
    FROM dbo.RISK_EVALUATION AS e
    INNER JOIN dbo.RISK_LIBRARY AS rl
      ON rl.risk_library_id = e.risk_library_id
    LEFT JOIN dbo.[USER] AS u
      ON u.user_id = e.evaluated_by_user_id
    WHERE ${filters}
    ORDER BY e.created_at DESC, e.evaluation_id DESC
    OFFSET @offset ROWS
    FETCH NEXT @pageSize ROWS ONLY;

    SELECT COUNT_BIG(*) AS total
    FROM dbo.RISK_EVALUATION AS e
    INNER JOIN dbo.RISK_LIBRARY AS rl
      ON rl.risk_library_id = e.risk_library_id
    WHERE ${filters};
  `);

  return {
    evaluations: result.recordsets[0],
    total: Number(result.recordsets[1][0].total),
  };
}

export async function getRiskEvaluationSummary({
  search = "",
  department = "",
  level = "",
  fromDate = null,
  toDate = null,
} = {}) {
  const pool = await getPool();

  const request = pool.request()
    .input("search", sql.NVarChar(200), `%${search}%`)
    .input("department", sql.NVarChar(100), department || null)
    .input("level", sql.NVarChar(20), level || null)
    .input("fromDate", sql.DateTime2, fromDate)
    .input("toDate", sql.DateTime2, toDate);

  const filters = `
    (@search = '%%'
      OR rl.risk_name LIKE @search
      OR rl.risk_library_id LIKE @search)
    AND (@department IS NULL
      OR rl.audit_department = @department)
    AND (@level IS NULL
      OR e.risk_level = @level)
    AND (@fromDate IS NULL
      OR e.created_at >= @fromDate)
    AND (@toDate IS NULL
      OR e.created_at < @toDate)
  `;

  const result = await request.query(`
    SELECT COUNT_BIG(*) AS totalEvaluations
    FROM dbo.RISK_EVALUATION AS e
    INNER JOIN dbo.RISK_LIBRARY AS rl
      ON rl.risk_library_id = e.risk_library_id
    WHERE ${filters};

    SELECT
      e.risk_level AS label,
      COUNT_BIG(*) AS count
    FROM dbo.RISK_EVALUATION AS e
    INNER JOIN dbo.RISK_LIBRARY AS rl
      ON rl.risk_library_id = e.risk_library_id
    WHERE ${filters}
    GROUP BY e.risk_level
    ORDER BY COUNT_BIG(*) DESC;

    SELECT
      COALESCE(rl.audit_department, N'Sin departamento') AS label,
      COUNT_BIG(*) AS count
    FROM dbo.RISK_EVALUATION AS e
    INNER JOIN dbo.RISK_LIBRARY AS rl
      ON rl.risk_library_id = e.risk_library_id
    WHERE ${filters}
    GROUP BY rl.audit_department
    ORDER BY COUNT_BIG(*) DESC;

    SELECT
      CONVERT(char(7), e.created_at, 120) AS month,
      COUNT_BIG(*) AS count
    FROM dbo.RISK_EVALUATION AS e
    INNER JOIN dbo.RISK_LIBRARY AS rl
      ON rl.risk_library_id = e.risk_library_id
    WHERE ${filters}
      AND e.created_at >= DATEADD(
        MONTH,
        -5,
        DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)
      )
    GROUP BY CONVERT(char(7), e.created_at, 120)
    ORDER BY month ASC;
  `);

  return {
    totalEvaluations: Number(
      result.recordsets[0][0].totalEvaluations
    ),
    byLevel: result.recordsets[1].map((item) => ({
      label: item.label,
      count: Number(item.count),
    })),
    byDepartment: result.recordsets[2].map((item) => ({
      label: item.label,
      count: Number(item.count),
    })),
    monthlyTrend: result.recordsets[3].map((item) => ({
      month: item.month,
      count: Number(item.count),
    })),
  };
}

export async function getEvaluationsForRisk(riskLibraryId) {
  const pool = await getPool();

  const result = await pool.request()
    .input("riskLibraryId", sql.VarChar(30), riskLibraryId)
    .query(`
      SELECT TOP (2)
        e.evaluation_id,
        e.risk_library_id,
        rl.risk_name,
        rl.audit_department,
        e.probability,
        e.impact,
        e.risk_score,
        e.risk_level,
        e.evaluated_by_user_id,
        u.full_name AS evaluated_by_name,
        e.created_at
      FROM dbo.RISK_EVALUATION AS e
      INNER JOIN dbo.RISK_LIBRARY AS rl
        ON rl.risk_library_id = e.risk_library_id
      LEFT JOIN dbo.[USER] AS u
        ON u.user_id = e.evaluated_by_user_id
      WHERE e.risk_library_id = @riskLibraryId
      ORDER BY e.created_at DESC, e.evaluation_id DESC;
    `);

  return result.recordset;
}



export async function getRiskEvaluationsByRiskId(
  riskLibraryId,
  limit = 100
) {
  const pool = await getPool();

  const result = await pool
    .request()
    .input('riskLibraryId', sql.VarChar(30), riskLibraryId)
    .input('limit', sql.Int, limit)
    .query(`
      SELECT TOP (@limit)
        e.evaluation_id,
        e.risk_library_id,
        rl.risk_name,
        rl.audit_department,
        e.probability,
        e.impact,
        e.risk_score,
        e.risk_level,
        e.evaluated_by_user_id,
        u.full_name AS evaluated_by_name,
        e.created_at
      FROM dbo.RISK_EVALUATION AS e
      INNER JOIN dbo.RISK_LIBRARY AS rl
        ON rl.risk_library_id = e.risk_library_id
      LEFT JOIN dbo.[USER] AS u
        ON u.user_id = e.evaluated_by_user_id
      WHERE e.risk_library_id = @riskLibraryId
      ORDER BY
        e.created_at DESC,
        e.evaluation_id DESC;
    `);

  return result.recordset;
}



