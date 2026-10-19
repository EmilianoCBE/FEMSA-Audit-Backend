
import { getPool, sql } from '../db/db.js';

/**
 * Consulta los riesgos registrados en la biblioteca de FEMSA.
 */
export async function findRiskLibrary({ search = '', department = '' } = {}) {
  const pool = await getPool();

  const request = pool.request()
    .input('search', sql.NVarChar(600), `%${search.trim()}%`)
    .input('department', sql.NVarChar(200), department.trim());

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
    .input('riskLibraryId', sql.VarChar(30), riskLibraryId)
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
