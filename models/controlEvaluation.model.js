
import { getPool, sql } from "../db/db.js";

/**
 * Información organizacional asociada a cada control.
 *
 * CONTROL_CATALOG permite que un control tenga varios catálogos.
 * ORG_CATALOG contiene la jerarquía organizacional.
 *
 * Se agregan los valores para evitar duplicar controles
 * cuando tienen más de una relación de catálogo.
 */
const catalogInfoApply = `
  OUTER APPLY (
    SELECT
      (
        SELECT STRING_AGG(CONVERT(NVARCHAR(MAX), x.value), N' | ')
        FROM (
          SELECT DISTINCT cc.catalog_code AS value
          FROM dbo.CONTROL_CATALOG AS cc
          WHERE cc.control_id = c.control_id
        ) AS x
      ) AS catalog_codes,

      (
        SELECT STRING_AGG(CONVERT(NVARCHAR(MAX), x.value), N' | ')
        FROM (
          SELECT DISTINCT cc.audit_department AS value
          FROM dbo.CONTROL_CATALOG AS cc
          WHERE cc.control_id = c.control_id
            AND NULLIF(LTRIM(RTRIM(cc.audit_department)), N'') IS NOT NULL
        ) AS x
      ) AS audit_departments,

      (
        SELECT STRING_AGG(CONVERT(NVARCHAR(MAX), x.value), N' | ')
        FROM (
          SELECT DISTINCT cc.audit_domain AS value
          FROM dbo.CONTROL_CATALOG AS cc
          WHERE cc.control_id = c.control_id
            AND NULLIF(LTRIM(RTRIM(cc.audit_domain)), N'') IS NOT NULL
        ) AS x
      ) AS audit_domains,

      (
        SELECT STRING_AGG(CONVERT(NVARCHAR(MAX), x.value), N' | ')
        FROM (
          SELECT DISTINCT oc.business_unit_code AS value
          FROM dbo.CONTROL_CATALOG AS cc
          INNER JOIN dbo.ORG_CATALOG AS oc
            ON oc.catalog_code = cc.catalog_code
          WHERE cc.control_id = c.control_id
            AND oc.business_unit_code IS NOT NULL
        ) AS x
      ) AS business_units,

      (
        SELECT STRING_AGG(CONVERT(NVARCHAR(MAX), x.value), N' | ')
        FROM (
          SELECT DISTINCT oc.division_code AS value
          FROM dbo.CONTROL_CATALOG AS cc
          INNER JOIN dbo.ORG_CATALOG AS oc
            ON oc.catalog_code = cc.catalog_code
          WHERE cc.control_id = c.control_id
            AND oc.division_code IS NOT NULL
        ) AS x
      ) AS divisions,

      (
        SELECT STRING_AGG(CONVERT(NVARCHAR(MAX), x.value), N' | ')
        FROM (
          SELECT DISTINCT oc.subdivision_code AS value
          FROM dbo.CONTROL_CATALOG AS cc
          INNER JOIN dbo.ORG_CATALOG AS oc
            ON oc.catalog_code = cc.catalog_code
          WHERE cc.control_id = c.control_id
            AND oc.subdivision_code IS NOT NULL
        ) AS x
      ) AS subdivisions,

      (
        SELECT STRING_AGG(CONVERT(NVARCHAR(MAX), x.value), N' | ')
        FROM (
          SELECT DISTINCT oc.area_name AS value
          FROM dbo.CONTROL_CATALOG AS cc
          INNER JOIN dbo.ORG_CATALOG AS oc
            ON oc.catalog_code = cc.catalog_code
          WHERE cc.control_id = c.control_id
            AND NULLIF(LTRIM(RTRIM(oc.area_name)), N'') IS NOT NULL
        ) AS x
      ) AS areas,

      (
        SELECT STRING_AGG(CONVERT(NVARCHAR(MAX), x.value), N' | ')
        FROM (
          SELECT DISTINCT oc.country AS value
          FROM dbo.CONTROL_CATALOG AS cc
          INNER JOIN dbo.ORG_CATALOG AS oc
            ON oc.catalog_code = cc.catalog_code
          WHERE cc.control_id = c.control_id
            AND NULLIF(LTRIM(RTRIM(oc.country)), N'') IS NOT NULL
        ) AS x
      ) AS countries
  ) AS catalog_info
`;


/**
 * US07 - Obtiene los riesgos registrados y sus controles asociados.
 * Utiliza RISK y CONTROL, no RISK_LIBRARY.
 *
 * Incluye los datos organizacionales de cada control.
 */
export async function findRisksWithControls() {
  const pool = await getPool();

  const result = await pool.request().query(`
    SELECT
      r.risk_id,
      r.tracking_id AS risk_tracking_id,
      r.name AS risk_name,
      r.category,
      r.inherent_level,

      c.control_id,
      c.tracking_id AS control_tracking_id,
      c.name AS control_name,
      c.domain,

      catalog_info.catalog_codes,
      catalog_info.audit_departments,
      catalog_info.audit_domains,
      catalog_info.business_units,
      catalog_info.divisions,
      catalog_info.subdivisions,
      catalog_info.areas,
      catalog_info.countries,
      latest.vulnerability AS latest_vulnerability

    FROM dbo.RISK AS r

    LEFT JOIN dbo.CONTROL AS c
      ON c.risk_id = r.risk_id

    ${catalogInfoApply}

    OUTER APPLY (
      SELECT TOP (1)
        ce.vulnerability
      FROM dbo.CONTROL_EVALUATION AS ce
      WHERE ce.control_id = c.control_id
      ORDER BY
        ce.evaluated_at DESC,
        ce.evaluation_id DESC
    ) AS latest

    WHERE r.tracking_id NOT IN (
      'RSK-000101',
      'RSK-000102',
      'RSK-000103',
      'RSK-000104',
      'RSK-000105',
      'RSK-000106',
      'RSK-000107',
      'RSK-000108',
      'RSK-000109',
      'RSK-000110'
    )

    ORDER BY
      r.tracking_id ASC,
      c.tracking_id ASC;
  `);

  return result.recordset;
}


/**
 * US07 - Obtiene un riesgo, sus controles y la última evaluación
 * disponible de cada control.
 *
 * Los datos organizacionales se agregan sin duplicar controles
 * ni modificar la selección de la última evaluación.
 */
export async function findRiskWithControls(riskTrackingId) {
  const pool = await getPool();

  const result = await pool
    .request()
    .input("riskTrackingId", sql.VarChar(30), riskTrackingId)
    .query(`
      SELECT
        r.risk_id,
        r.tracking_id AS risk_tracking_id,
        r.name AS risk_name,
        r.category,
        r.inherent_level,

        c.control_id,
        c.tracking_id AS control_tracking_id,
        c.name AS control_name,
        c.domain,

        catalog_info.catalog_codes,
        catalog_info.audit_departments,
        catalog_info.audit_domains,
        catalog_info.business_units,
        catalog_info.divisions,
        catalog_info.subdivisions,
        catalog_info.areas,
        catalog_info.countries,

        latest.evaluation_id,
        latest.probability,
        latest.impact,
        latest.inherent_level AS evaluated_inherent_level,
        latest.design_rating,
        latest.effectiveness_rating,
        latest.control_level,
        latest.vulnerability,
        latest.evaluated_at,
        latest.comments,
        latest.evaluated_by_user_id,
        latest.evaluated_by_user_name

      FROM dbo.RISK AS r

      LEFT JOIN dbo.CONTROL AS c
        ON c.risk_id = r.risk_id

      ${catalogInfoApply}

      OUTER APPLY (
        SELECT TOP (1)
          ce.evaluated_by_user_id,
          u.full_name AS evaluated_by_user_name,
          ce.evaluation_id,
          ce.probability,
          ce.impact,
          ce.inherent_level,
          ce.design_rating,
          ce.effectiveness_rating,
          ce.control_level,
          ce.vulnerability,
          ce.evaluated_at,
          ce.comments
        FROM dbo.CONTROL_EVALUATION AS ce
        LEFT JOIN dbo.[USER] AS u
            ON u.user_id = ce.evaluated_by_user_id
        WHERE ce.control_id = c.control_id
        ORDER BY
          ce.evaluated_at DESC,
          ce.evaluation_id DESC
      ) AS latest

      WHERE r.tracking_id = @riskTrackingId

      ORDER BY c.tracking_id ASC;
    `);

  return result.recordset;
}


/**
 * US07 - Obtiene el historial completo de evaluaciones de un control.
 * Las evaluaciones anteriores se conservan.
 *
 * También devuelve la información organizacional del control.
 */
export async function findControlEvaluationHistory(controlId) {
  const pool = await getPool();

  const result = await pool
    .request()
    .input("controlId", sql.Int, controlId)
    .query(`
      SELECT
        c.control_id,
        c.tracking_id AS control_tracking_id,
        c.name AS control_name,

        r.risk_id,
        r.tracking_id AS risk_tracking_id,
        r.name AS risk_name,

        catalog_info.catalog_codes,
        catalog_info.audit_departments,
        catalog_info.audit_domains,
        catalog_info.business_units,
        catalog_info.divisions,
        catalog_info.subdivisions,
        catalog_info.areas,
        catalog_info.countries,

        ce.evaluation_id,
        ce.probability,
        ce.impact,
        ce.inherent_level,
        ce.design_rating,
        ce.effectiveness_rating,
        ce.control_level,
        ce.vulnerability,
        ce.evaluated_by_user_id,
        evaluator.full_name AS evaluated_by_user_name,
        ce.evaluated_at,
        ce.comments

      FROM dbo.CONTROL AS c

      INNER JOIN dbo.RISK AS r
        ON r.risk_id = c.risk_id

      ${catalogInfoApply}

      LEFT JOIN dbo.CONTROL_EVALUATION AS ce
        ON ce.control_id = c.control_id

    LEFT JOIN dbo.[USER] AS evaluator
        ON evaluator.user_id = ce.evaluated_by_user_id

      WHERE c.control_id = @controlId

      ORDER BY
        ce.evaluated_at DESC,
        ce.evaluation_id DESC;
    `);

  return result.recordset;
}


/**
 * US07 - Guarda una nueva evaluación de un control.
 *
 * El usuario autenticado se relaciona con dbo.USER mediante AuthUsers.
 * Cada evaluación se inserta como un registro nuevo.
 */
export async function createControlEvaluation({
  controlId,
  probability,
  impact,
  inherentLevel,
  designRating,
  effectivenessRating,
  controlLevel,
  vulnerability,
  authUserId,
  comments,
}) {
  const pool = await getPool();

  // Identificar al usuario de la tabla USER a partir de su sesión.
  const userResult = await pool
    .request()
    .input("authUserId", sql.UniqueIdentifier, authUserId)
    .query(`
      SELECT u.user_id
      FROM dbo.AuthUsers AS au
      INNER JOIN dbo.[USER] AS u
        ON u.user_id = au.UserId
      WHERE au.Id = @authUserId
        AND au.IsActive = 1
        AND u.is_active = 1;
    `);

  if (userResult.recordset.length === 0) {
    return { error: "USER_NOT_FOUND" };
  }

  const userId = userResult.recordset[0].user_id;

  // Verificar que el control exista.
  const controlResult = await pool
    .request()
    .input("controlId", sql.Int, controlId)
    .query(`
      SELECT control_id
      FROM dbo.CONTROL
      WHERE control_id = @controlId;
    `);

  if (controlResult.recordset.length === 0) {
    return { error: "CONTROL_NOT_FOUND" };
  }

  // Insertar una nueva fila; nunca sobrescribir evaluaciones anteriores.
  const result = await pool
    .request()
    .input("controlId", sql.Int, controlId)
    .input("probability", sql.NVarChar(30), probability)
    .input("impact", sql.NVarChar(30), impact)
    .input("inherentLevel", sql.NVarChar(20), inherentLevel)
    .input("designRating", sql.NVarChar(20), designRating)
    .input("effectivenessRating", sql.NVarChar(20), effectivenessRating)
    .input("controlLevel", sql.NVarChar(20), controlLevel)
    .input("vulnerability", sql.NVarChar(20), vulnerability)
    .input("userId", sql.Int, userId)
    .input("comments", sql.NVarChar(2000), comments ?? null)
    .query(`
      INSERT INTO dbo.CONTROL_EVALUATION
      (
        control_id,
        probability,
        impact,
        inherent_level,
        design_rating,
        effectiveness_rating,
        control_level,
        vulnerability,
        evaluated_by_user_id,
        comments
      )
      OUTPUT
        inserted.evaluation_id,
        inserted.control_id,
        inserted.probability,
        inserted.impact,
        inserted.inherent_level,
        inserted.design_rating,
        inserted.effectiveness_rating,
        inserted.control_level,
        inserted.vulnerability,
        inserted.evaluated_by_user_id,
        inserted.evaluated_at,
        inserted.comments
      VALUES
      (
        @controlId,
        @probability,
        @impact,
        @inherentLevel,
        @designRating,
        @effectivenessRating,
        @controlLevel,
        @vulnerability,
        @userId,
        @comments
      );
    `);

  return result.recordset[0];
}
