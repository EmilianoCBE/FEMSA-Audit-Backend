import { getPool, sql } from '../db/db.js';

/**
 * Obtiene todos los usuarios registrados junto con su rol.
 * US02.1 - Se muestra una lista de usuarios.
 */
export async function findAllUsers() {
  const pool = await getPool();

  const result = await pool.request().query(`
    SELECT 
      u.user_id, 
      u.entra_id, 
      u.email, 
      u.full_name, 
      u.is_active, 
      u.created_at, 
      r.role_id, 
      r.name AS role_name, 
      r.description AS role_description 
    FROM dbo.[USER] AS u 
    INNER JOIN dbo.[ROLE] AS r 
      ON u.role_id = r.role_id 
    ORDER BY u.full_name ASC;
  `);

  return result.recordset;
}

/**
 * Obtiene todos los roles disponibles.
 * US02.2 - Se utilizan para permitir la asignación de roles.
 */
export async function findAllRoles() {
  const pool = await getPool();

  const result = await pool.request().query(`
    SELECT 
      role_id, 
      name, 
      description 
    FROM dbo.[ROLE] 
    ORDER BY name ASC;
  `);

  return result.recordset;
}

/**
 * Asigna un rol a un usuario.
 * US02.2 - Se pueden asignar roles.
 */
export async function updateUserRole(userId, roleId) {
  const pool = await getPool();

  // Primero verificamos que el rol exista.
  const roleResult = await pool
    .request()
    .input('roleId', sql.Int, roleId)
    .query(`
      SELECT 
        role_id,
        name,
        description
      FROM dbo.[ROLE]
      WHERE role_id = @roleId;
    `);

  if (roleResult.recordset.length === 0) {
    return null;
  }

  const result = await pool
    .request()
    .input('userId', sql.Int, userId)
    .input('roleId', sql.Int, roleId)
    .query(`
      UPDATE dbo.[USER]
      SET role_id = @roleId
      OUTPUT 
        inserted.user_id, 
        inserted.email, 
        inserted.full_name, 
        inserted.role_id 
      WHERE user_id = @userId;
    `);

  return result.recordset[0];
}