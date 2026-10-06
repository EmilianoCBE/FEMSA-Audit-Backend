import { getPool, sql } from '../db/db.js';

const userColumns = `
  a.Id,
  a.Username,
  a.Email,
  u.full_name AS Name,
  a.PasswordHash,
  CAST(CASE WHEN a.IsActive = 1 AND u.is_active = 1 THEN 1 ELSE 0 END AS bit) AS IsActive,
  a.UserId,
  u.role_id,
  r.name AS Role
`;

export async function findUserByIdentifier(identifier) {
  const pool = await getPool();

  const result = await pool
    .request()
    .input('identifier', sql.NVarChar(254), identifier)
    .query(`
      SELECT
        ${userColumns}
      FROM dbo.AuthUsers AS a
      INNER JOIN dbo.[USER] AS u
        ON a.UserId = u.user_id
      INNER JOIN dbo.[ROLE] AS r
        ON u.role_id = r.role_id
      WHERE ${
        identifier.includes('@')
          ? 'a.Email'
          : 'a.Username'
      } = @identifier
    `);

  return result.recordset[0];
}

export async function findUserByEntraId(oid) {
  const pool = await getPool();

  const result = await pool
    .request()
    .input('oid', sql.UniqueIdentifier, oid)
    .query(`
      SELECT
        ${userColumns}
      FROM dbo.AuthUsers AS a
      INNER JOIN dbo.[USER] AS u
        ON a.UserId = u.user_id
      INNER JOIN dbo.[ROLE] AS r
        ON u.role_id = r.role_id
      WHERE a.EntraObjectId = @oid
        AND a.IsActive = 1
        AND u.is_active = 1
    `);

  return result.recordset[0];
}

export async function insertSession(hash, userId, expiresAt) {
  const pool = await getPool();

  await pool
    .request()
    .input('hash', sql.Char(64), hash)
    .input('userId', sql.UniqueIdentifier, userId)
    .input('expiresAt', sql.DateTime2, expiresAt)
    .query(`
      DELETE FROM dbo.AuthSessions
      WHERE ExpiresAt <= SYSUTCDATETIME();

      INSERT INTO dbo.AuthSessions
      (
        TokenHash,
        UserId,
        ExpiresAt
      )
      VALUES
      (
        @hash,
        @userId,
        @expiresAt
      );
    `);
}

export async function findSession(hash) {
  const pool = await getPool();

  const result = await pool
    .request()
    .input('hash', sql.Char(64), hash)
    .query(`
      SELECT
        a.Id,
        u.full_name AS Name,
        r.name AS Role
      FROM dbo.AuthSessions AS s
      INNER JOIN dbo.AuthUsers AS a
        ON a.Id = s.UserId
      INNER JOIN dbo.[USER] AS u
        ON a.UserId = u.user_id
      INNER JOIN dbo.[ROLE] AS r
        ON u.role_id = r.role_id
      WHERE s.TokenHash = @hash
        AND s.ExpiresAt > SYSUTCDATETIME()
        AND a.IsActive = 1
        AND u.is_active = 1
    `);

  return result.recordset[0];
}

export async function deleteSession(hash) {
  const pool = await getPool();

  await pool
    .request()
    .input('hash', sql.Char(64), hash)
    .query(`
      DELETE FROM dbo.AuthSessions
      WHERE TokenHash = @hash
    `);
}

export function publicUser(user) {
  return {
    id: user.Id,
    name: user.Name,
    role: user.Role,
    initials: user.Name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map(word => word[0])
      .join('')
      .toUpperCase()
  };
}
