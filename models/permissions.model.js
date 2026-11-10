import { getPool, sql } from "../db/db.js";
import { MODULES } from "../utils/permissions.js";

export async function findRolePermissions(roleId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("roleId", sql.Int, roleId)
    .query(`
    SELECT ModuleKey, Level FROM dbo.RoleModulePermissions WHERE RoleId = @roleId;
  `);
  return Object.fromEntries(
    MODULES.map(({ id }) => [id, result.recordset.find((row) => row.ModuleKey === id)?.Level ?? "hidden"]),
  );
}
export async function findPermissionMatrix() {
  const pool = await getPool();
  const roles = (await pool.request().query("SELECT role_id, name FROM dbo.[ROLE] ORDER BY name;")).recordset;
  const rows = (await pool.request().query("SELECT RoleId, ModuleKey, Level FROM dbo.RoleModulePermissions;"))
    .recordset;
  return {
    roles: roles.map((role) => ({ id: String(role.role_id), label: role.name })),
    permissions: MODULES.map(({ id, label }) => ({
      fieldId: id,
      fieldName: label,
      levels: Object.fromEntries(
        roles.map((role) => [
          String(role.role_id),
          Number(role.role_id) === 2
            ? "edit"
            : (rows.find((row) => row.RoleId === role.role_id && row.ModuleKey === id)?.Level ?? "hidden"),
        ]),
      ),
    })),
  };
}
export async function saveRolePermission(roleId, moduleId, level) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("roleId", sql.Int, roleId)
    .input("moduleId", sql.VarChar(30), moduleId)
    .input("level", sql.VarChar(10), level)
    .query(`
      IF NOT EXISTS (SELECT 1 FROM dbo.[ROLE] WHERE role_id = @roleId)
        SELECT CAST(0 AS bit) AS found;
      ELSE BEGIN
        MERGE dbo.RoleModulePermissions WITH (HOLDLOCK) AS target
        USING (SELECT @roleId AS RoleId, @moduleId AS ModuleKey) AS source
          ON target.RoleId = source.RoleId AND target.ModuleKey = source.ModuleKey
        WHEN MATCHED THEN UPDATE SET Level = @level, UpdatedAt = SYSUTCDATETIME()
        WHEN NOT MATCHED THEN INSERT (RoleId, ModuleKey, Level) VALUES (@roleId, @moduleId, @level);
        SELECT CAST(1 AS bit) AS found;
      END;
    `);
  return Boolean(result.recordset[0]?.found);
}
