import { getPool, sql } from '../db/db.js';

const userTables = 'dbo.AuthUsers a JOIN dbo.[USER] u ON u.user_id = a.UserId JOIN dbo.[ROLE] r ON r.role_id = u.role_id';
const columns = 'a.Id, a.Username, a.Email, u.full_name AS Name, r.name AS Role, CAST(CASE WHEN a.IsActive = 1 AND u.is_active = 1 THEN 1 ELSE 0 END AS bit) AS IsActive';
export async function findUserByIdentifier(identifier) {
  const pool = await getPool();
  const result = await pool.request().input('identifier', sql.NVarChar(254), identifier)
    .query(`SELECT ${columns}, a.PasswordHash FROM ${userTables} WHERE ${identifier.includes('@') ? 'a.Email' : 'a.Username'} = @identifier`);
  return result.recordset[0];
}
export async function findUserByEntraId(oid) {
  const pool = await getPool();
  const result = await pool.request().input('oid', sql.UniqueIdentifier, oid)
    .query(`SELECT ${columns} FROM ${userTables} WHERE a.EntraObjectId = @oid AND a.IsActive = 1 AND u.is_active = 1`);
  return result.recordset[0];
}
export async function insertSession(hash, userId, expiresAt) {
  const pool = await getPool();
  await pool.request().input('hash', sql.Char(64), hash).input('userId', sql.UniqueIdentifier, userId)
    .input('expiresAt', sql.DateTime2, expiresAt)
    .query('DELETE FROM dbo.AuthSessions WHERE ExpiresAt <= SYSUTCDATETIME(); INSERT INTO dbo.AuthSessions (TokenHash, UserId, ExpiresAt) VALUES (@hash, @userId, @expiresAt)');
}
export async function findSession(hash) {
  const pool = await getPool();
  const result = await pool.request().input('hash', sql.Char(64), hash)
    .query(`SELECT a.Id, u.full_name AS Name, r.name AS Role FROM ${userTables} JOIN dbo.AuthSessions s ON a.Id = s.UserId WHERE s.TokenHash = @hash AND s.ExpiresAt > SYSUTCDATETIME() AND a.IsActive = 1 AND u.is_active = 1`);
  return result.recordset[0];
}
export async function deleteSession(hash) {
  const pool = await getPool();
  await pool.request().input('hash', sql.Char(64), hash).query('DELETE FROM dbo.AuthSessions WHERE TokenHash = @hash');
}
export function publicUser(user) {
  return { id: user.Id, name: user.Name, role: user.Role,
    initials: user.Name.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase() };
}
