import { getPool, sql } from '../db/db.js';

const columns = 'Id, Username, Email, Name, Role, IsActive';
export async function findUserByIdentifier(identifier) {
  const pool = await getPool();
  const result = await pool.request().input('identifier', sql.NVarChar(254), identifier)
    .query(`SELECT ${columns}, PasswordHash FROM dbo.AuthUsers WHERE ${identifier.includes('@') ? 'Email' : 'Username'} = @identifier`);
  return result.recordset[0];
}
export async function findUserByEntraId(oid) {
  const pool = await getPool();
  const result = await pool.request().input('oid', sql.UniqueIdentifier, oid)
    .query(`SELECT ${columns} FROM dbo.AuthUsers WHERE EntraObjectId = @oid AND IsActive = 1`);
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
    .query('SELECT u.Id, u.Name, u.Role FROM dbo.AuthSessions s JOIN dbo.AuthUsers u ON u.Id = s.UserId WHERE s.TokenHash = @hash AND s.ExpiresAt > SYSUTCDATETIME() AND u.IsActive = 1');
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
