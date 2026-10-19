import { getPool, sql } from "../db/db.js";

/**
 * Obtiene los permisos asignados a un rol.
 * US14.2 - Se determina su rol y permisos.
 */
export async function findPermissionsByRoleId(roleId) {
  const pool = await getPool();

  const result = await pool
    .request()
    .input("roleId", sql.Int, roleId)
    .query(`
      SELECT
        p.permission_id,
        p.name,
        p.module
      FROM dbo.ROLE_PERMISSION AS rp
      INNER JOIN dbo.PERMISSION AS p
        ON rp.permission_id = p.permission_id
      WHERE rp.role_id = @roleId
      ORDER BY p.module, p.name;
    `);

  return result.recordset;
}
