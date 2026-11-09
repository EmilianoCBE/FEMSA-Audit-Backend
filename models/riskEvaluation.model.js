import { getPool, sql } from "../db/db.js";

export async function createRiskEvaluation({ riskLibraryId, probability, impact, score, level, authUserId }) {
  const pool = await getPool();

  const result = await pool
    .request()
    .input("riskLibraryId", sql.NVarChar(30), riskLibraryId)
    .input("probability", sql.Int, probability)
    .input("impact", sql.Int, impact)
    .input("score", sql.Int, score)
    .input("level", sql.NVarChar(20), level)
    .input("authUserId", sql.UniqueIdentifier, authUserId)
    .query(`
      INSERT INTO dbo.RISK_EVALUATION (
        risk_library_id,
        probability,
        impact,
        risk_score,
        risk_level,
        evaluated_by_user_id,
        created_at
      )
      OUTPUT
        INSERTED.evaluation_id,
        INSERTED.risk_library_id,
        INSERTED.probability,
        INSERTED.impact,
        INSERTED.risk_score,
        INSERTED.risk_level,
        INSERTED.evaluated_by_user_id,
        INSERTED.created_at
      SELECT
        rl.risk_library_id,
        @probability,
        @impact,
        @score,
        @level,
        u.user_id,
        SYSUTCDATETIME()
      FROM dbo.RISK_LIBRARY rl
      INNER JOIN dbo.AuthUsers au
        ON au.id = @authUserId
      INNER JOIN dbo.[USER] u
        ON u.email = au.email
      WHERE
        rl.risk_library_id = @riskLibraryId
        AND u.is_active = 1
        AND au.IsActive = 1;
    `);

  return result.recordset[0] ?? null;
}

export async function getRecentRiskEvaluations(limit = 5) {
  const pool = await getPool();

  const result = await pool
    .request()
    .input("limit", sql.Int, limit)
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
      FROM dbo.RISK_EVALUATION e
      INNER JOIN dbo.RISK_LIBRARY rl
        ON rl.risk_library_id = e.risk_library_id
      LEFT JOIN dbo.[USER] u
        ON u.user_id = e.evaluated_by_user_id
      ORDER BY e.created_at DESC, e.evaluation_id DESC;
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
  const request = pool.request();

  request.input("search", sql.NVarChar(200), `%${search}%`);
  request.input("department", sql.NVarChar(100), department || null);
  request.input("level", sql.NVarChar(20), level || null);
  request.input("fromDate", sql.DateTime2, fromDate);
  request.input("toDate", sql.DateTime2, toDate);
  request.input("offset", sql.Int, (page - 1) * pageSize);
  request.input("pageSize", sql.Int, pageSize);

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
    FROM dbo.RISK_EVALUATION e
    INNER JOIN dbo.RISK_LIBRARY rl
      ON rl.risk_library_id = e.risk_library_id
    LEFT JOIN dbo.[USER] u
      ON u.user_id = e.evaluated_by_user_id
    WHERE
      (
        @search = '%%'
        OR rl.risk_name LIKE @search
        OR rl.risk_library_id LIKE @search
      )
      AND (
        @department IS NULL
        OR rl.audit_department = @department
      )
      AND (
        @level IS NULL
        OR e.risk_level = @level
      )
      AND (
        @fromDate IS NULL
        OR e.created_at >= @fromDate
      )
      AND (
        @toDate IS NULL
        OR e.created_at < @toDate
      )
    ORDER BY e.created_at DESC, e.evaluation_id DESC
    OFFSET @offset ROWS
    FETCH NEXT @pageSize ROWS ONLY;

    SELECT COUNT_BIG(*) AS total
    FROM dbo.RISK_EVALUATION e
    INNER JOIN dbo.RISK_LIBRARY rl
      ON rl.risk_library_id = e.risk_library_id
    WHERE
      (
        @search = '%%'
        OR rl.risk_name LIKE @search
        OR rl.risk_library_id LIKE @search
      )
      AND (
        @department IS NULL
        OR rl.audit_department = @department
      )
      AND (
        @level IS NULL
        OR e.risk_level = @level
      )
      AND (
        @fromDate IS NULL
        OR e.created_at >= @fromDate
      )
      AND (
        @toDate IS NULL
        OR e.created_at < @toDate
      );
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
  const request = pool.request();

  request.input("search", sql.NVarChar(200), `%${search}%`);
  request.input("department", sql.NVarChar(100), department || null);
  request.input("level", sql.NVarChar(20), level || null);
  request.input("fromDate", sql.DateTime2, fromDate);
  request.input("toDate", sql.DateTime2, toDate);

  const result = await request.query(`
    ;WITH FilteredEvaluations AS (
      SELECT
        e.evaluation_id,
        e.probability,
        e.impact,
        e.risk_score,
        e.risk_level,
        e.created_at,
        rl.risk_library_id,
        rl.risk_name,
        rl.audit_department
      FROM dbo.RISK_EVALUATION e
      INNER JOIN dbo.RISK_LIBRARY rl
        ON rl.risk_library_id = e.risk_library_id
      WHERE
        (
          @search = '%%'
          OR rl.risk_name LIKE @search
          OR rl.risk_library_id LIKE @search
        )
        AND (@department IS NULL OR rl.audit_department = @department)
        AND (@level IS NULL OR e.risk_level = @level)
        AND (@fromDate IS NULL OR e.created_at >= @fromDate)
        AND (@toDate IS NULL OR e.created_at < @toDate)
    )
    SELECT
      COUNT_BIG(*) AS totalEvaluations,
      COALESCE(
        AVG(CAST(risk_score AS DECIMAL(10, 2))),
        0
      ) AS averageScore,
      COALESCE(SUM(
        CASE WHEN risk_level = N'Alto' THEN 1 ELSE 0 END
      ), 0) AS highRisks,
      COALESCE(SUM(
        CASE WHEN risk_level = N'Crítico' THEN 1 ELSE 0 END
      ), 0) AS criticalRisks
    FROM FilteredEvaluations;

    ;WITH FilteredEvaluations AS (
      SELECT e.risk_level
      FROM dbo.RISK_EVALUATION e
      INNER JOIN dbo.RISK_LIBRARY rl
        ON rl.risk_library_id = e.risk_library_id
      WHERE
        (
          @search = '%%'
          OR rl.risk_name LIKE @search
          OR rl.risk_library_id LIKE @search
        )
        AND (@department IS NULL OR rl.audit_department = @department)
        AND (@level IS NULL OR e.risk_level = @level)
        AND (@fromDate IS NULL OR e.created_at >= @fromDate)
        AND (@toDate IS NULL OR e.created_at < @toDate)
    )
    SELECT
      levels.label,
      COUNT(fe.risk_level) AS count
    FROM (
      SELECT N'Bajo' AS label, 1 AS sort_order
      UNION ALL SELECT N'Medio', 2
      UNION ALL SELECT N'Alto', 3
      UNION ALL SELECT N'Crítico', 4
    ) levels
    LEFT JOIN FilteredEvaluations fe
      ON fe.risk_level = levels.label
    GROUP BY levels.label, levels.sort_order
    ORDER BY levels.sort_order;

    ;WITH FilteredEvaluations AS (
      SELECT rl.audit_department
      FROM dbo.RISK_EVALUATION e
      INNER JOIN dbo.RISK_LIBRARY rl
        ON rl.risk_library_id = e.risk_library_id
      WHERE
        (
          @search = '%%'
          OR rl.risk_name LIKE @search
          OR rl.risk_library_id LIKE @search
        )
        AND (@department IS NULL OR rl.audit_department = @department)
        AND (@level IS NULL OR e.risk_level = @level)
        AND (@fromDate IS NULL OR e.created_at >= @fromDate)
        AND (@toDate IS NULL OR e.created_at < @toDate)
    )
    SELECT
      COALESCE(audit_department, N'Sin departamento') AS label,
      COUNT(*) AS count
    FROM FilteredEvaluations
    GROUP BY audit_department
    ORDER BY count DESC;

    ;WITH FilteredEvaluations AS (
      SELECT e.created_at
      FROM dbo.RISK_EVALUATION e
      INNER JOIN dbo.RISK_LIBRARY rl
        ON rl.risk_library_id = e.risk_library_id
      WHERE
        (
          @search = '%%'
          OR rl.risk_name LIKE @search
          OR rl.risk_library_id LIKE @search
        )
        AND (@department IS NULL OR rl.audit_department = @department)
        AND (@level IS NULL OR e.risk_level = @level)
        AND (@fromDate IS NULL OR e.created_at >= @fromDate)
        AND (@toDate IS NULL OR e.created_at < @toDate)
    )
    SELECT
      CONVERT(char(7), created_at, 120) AS month,
      COUNT(*) AS count
    FROM FilteredEvaluations
    GROUP BY CONVERT(char(7), created_at, 120)
    ORDER BY month;

    ;WITH FilteredEvaluations AS (
      SELECT e.probability, e.impact
      FROM dbo.RISK_EVALUATION e
      INNER JOIN dbo.RISK_LIBRARY rl
        ON rl.risk_library_id = e.risk_library_id
      WHERE
        (
          @search = '%%'
          OR rl.risk_name LIKE @search
          OR rl.risk_library_id LIKE @search
        )
        AND (@department IS NULL OR rl.audit_department = @department)
        AND (@level IS NULL OR e.risk_level = @level)
        AND (@fromDate IS NULL OR e.created_at >= @fromDate)
        AND (@toDate IS NULL OR e.created_at < @toDate)
    )
    SELECT
      probabilities.probability,
      impacts.impact,
      COUNT(fe.probability) AS count
    FROM (
      SELECT 1 AS probability
      UNION ALL SELECT 2
      UNION ALL SELECT 3
      UNION ALL SELECT 4
      UNION ALL SELECT 5
    ) probabilities
    CROSS JOIN (
      SELECT 1 AS impact
      UNION ALL SELECT 2
      UNION ALL SELECT 3
      UNION ALL SELECT 4
      UNION ALL SELECT 5
    ) impacts
    LEFT JOIN FilteredEvaluations fe
      ON fe.probability = probabilities.probability
      AND fe.impact = impacts.impact
    GROUP BY probabilities.probability, impacts.impact
    ORDER BY probabilities.probability, impacts.impact;
    
    ;WITH FilteredEvaluations AS (
      SELECT
        e.risk_level,
        rl.audit_department
      FROM dbo.RISK_EVALUATION e
      INNER JOIN dbo.RISK_LIBRARY rl
        ON rl.risk_library_id = e.risk_library_id
      WHERE
        (
          @search = '%%'
          OR rl.risk_name LIKE @search
          OR rl.risk_library_id LIKE @search
        )
        AND (@department IS NULL OR rl.audit_department = @department)
        AND (@level IS NULL OR e.risk_level = @level)
        AND (@fromDate IS NULL OR e.created_at >= @fromDate)
        AND (@toDate IS NULL OR e.created_at < @toDate)
    )
    SELECT
      COALESCE(audit_department, N'Sin departamento') AS department,
      risk_level AS level,
      COUNT(*) AS count
    FROM FilteredEvaluations
    GROUP BY audit_department, risk_level
    ORDER BY department, level;

  `);

  const summary = result.recordsets[0][0];

  return {
    totalEvaluations: Number(summary.totalEvaluations),
    averageScore: Number(summary.averageScore),
    highRisks: Number(summary.highRisks ?? 0),
    criticalRisks: Number(summary.criticalRisks ?? 0),

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

    riskMatrix: result.recordsets[4].map((item) => ({
      probability: Number(item.probability),
      impact: Number(item.impact),
      count: Number(item.count),
    })),

    byDepartmentLevel: result.recordsets[5].map((item) => ({
      department: item.department,
      level: item.level,
      count: Number(item.count),
    })),
  };
}

export async function getEvaluationsForRisk(riskLibraryId) {
  const pool = await getPool();

  const result = await pool
    .request()
    .input("riskLibraryId", sql.NVarChar(30), riskLibraryId)
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
      FROM dbo.RISK_EVALUATION e
      INNER JOIN dbo.RISK_LIBRARY rl
        ON rl.risk_library_id = e.risk_library_id
      LEFT JOIN dbo.[USER] u
        ON u.user_id = e.evaluated_by_user_id
      WHERE e.risk_library_id = @riskLibraryId
      ORDER BY e.created_at DESC, e.evaluation_id DESC;
    `);

  return result.recordset;
}

export async function getRiskEvaluationsByRiskId(riskLibraryId, limit = 100) {
  const pool = await getPool();

  const result = await pool
    .request()
    .input("riskLibraryId", sql.NVarChar(30), riskLibraryId)
    .input("limit", sql.Int, limit)
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
      FROM dbo.RISK_EVALUATION e
      INNER JOIN dbo.RISK_LIBRARY rl
        ON rl.risk_library_id = e.risk_library_id
      LEFT JOIN dbo.[USER] u
        ON u.user_id = e.evaluated_by_user_id
      WHERE e.risk_library_id = @riskLibraryId
      ORDER BY e.created_at DESC, e.evaluation_id DESC;
    `);

  return result.recordset;
}
