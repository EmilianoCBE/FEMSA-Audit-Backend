// US11 - Rafael Valdez: acceso a dbo.AppVersions (solo SQL, sin reglas de negocio).
import { getPool, sql } from "../db/db.js";

const summaryColumns = `
  v.Id,
  v.AppId,
  v.VersionNumber,
  v.Status,
  v.Changes,
  v.AuthorName,
  v.CreatedAt,
  v.PublishedAt,
  v.PublishedByName,
  v.DiscardedAt,
  v.DiscardedByName,
  source.VersionNumber AS RestoredFromNumber
`;

const fromVersions = `
  FROM dbo.AppVersions AS v
  LEFT JOIN dbo.AppVersions AS source
    ON source.Id = v.RestoredFromId
`;

function toVersion(row) {
  return {
    id: row.Id,
    appId: row.AppId,
    number: row.VersionNumber,
    status: row.Status,
    changes: JSON.parse(row.Changes),
    authorName: row.AuthorName,
    createdAt: row.CreatedAt,
    publishedAt: row.PublishedAt,
    publishedByName: row.PublishedByName ?? null,
    discardedAt: row.DiscardedAt ?? null,
    discardedByName: row.DiscardedByName ?? null,
    restoredFromNumber: row.RestoredFromNumber ?? null,
    ...(row.Config !== undefined && { config: JSON.parse(row.Config) }),
  };
}

/** Historial visible (sin los borradores descartados), del más nuevo al más viejo. */
async function list(appId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("appId", sql.NVarChar(100), appId)
    .query(`
      SELECT ${summaryColumns}
      ${fromVersions}
      WHERE v.AppId = @appId AND v.Status <> 'discarded'
      ORDER BY v.VersionNumber DESC
    `);
  return result.recordset.map(toVersion);
}

async function findById(appId, id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("appId", sql.NVarChar(100), appId)
    .input("id", sql.Int, id)
    .query(`
      SELECT ${summaryColumns}, v.Config
      ${fromVersions}
      WHERE v.AppId = @appId AND v.Id = @id
    `);
  const row = result.recordset[0];
  return row ? toVersion(row) : null;
}

/** La versión más reciente que no se descartó, con su configuración; `null` si no hay ninguna. */
async function findLatest(appId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("appId", sql.NVarChar(100), appId)
    .query(`
      SELECT TOP (1) ${summaryColumns}, v.Config
      ${fromVersions}
      WHERE v.AppId = @appId AND v.Status <> 'discarded'
      ORDER BY v.VersionNumber DESC
    `);
  const row = result.recordset[0];
  return row ? toVersion(row) : null;
}

/** Inserta un borrador con el siguiente número de versión de la aplicación (en una sola sentencia). */
async function create({ appId, config, changes, authorId, authorName, restoredFromId = null }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("appId", sql.NVarChar(100), appId)
    .input("config", sql.NVarChar(sql.MAX), JSON.stringify(config))
    .input("changes", sql.NVarChar(sql.MAX), JSON.stringify(changes))
    .input("authorId", sql.UniqueIdentifier, authorId)
    .input("authorName", sql.NVarChar(150), authorName)
    .input("restoredFromId", sql.Int, restoredFromId)
    .query(`
      INSERT INTO dbo.AppVersions (AppId, VersionNumber, Status, Config, Changes, AuthorId, AuthorName, RestoredFromId)
      OUTPUT INSERTED.Id
      SELECT @appId, ISNULL(MAX(VersionNumber), 0) + 1, 'draft', @config, @changes, @authorId, @authorName, @restoredFromId
      FROM dbo.AppVersions WITH (UPDLOCK, HOLDLOCK)
      WHERE AppId = @appId
    `);
  return findById(appId, result.recordset[0].Id);
}

/**
 * Archiva la versión vigente y publica el borrador indicado, en una transacción.
 * Si el borrador ya no está en borrador (otra sesión lo publicó o descartó primero), deshace todo
 * para no dejar la aplicación sin versión vigente, y devuelve `null`.
 */
async function publish(appId, id, { userId, userName }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("appId", sql.NVarChar(100), appId)
    .input("id", sql.Int, id)
    .input("userId", sql.UniqueIdentifier, userId)
    .input("userName", sql.NVarChar(150), userName)
    .query(`
      SET XACT_ABORT ON;
      BEGIN TRANSACTION;

      UPDATE dbo.AppVersions
      SET Status = 'archived'
      WHERE AppId = @appId AND Status = 'current';

      UPDATE dbo.AppVersions
      SET Status = 'current', PublishedAt = SYSUTCDATETIME(), PublishedById = @userId, PublishedByName = @userName
      WHERE AppId = @appId AND Id = @id AND Status = 'draft';

      IF @@ROWCOUNT = 0
      BEGIN
        ROLLBACK TRANSACTION;
        SELECT CAST(0 AS BIT) AS Published;
      END
      ELSE
      BEGIN
        COMMIT TRANSACTION;
        SELECT CAST(1 AS BIT) AS Published;
      END;
    `);
  return result.recordset[0]?.Published ? findById(appId, id) : null;
}

/** Marca un borrador como descartado (no borra la fila). Devuelve `null` si ya no era borrador. */
async function discard(appId, id, { userId, userName }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("appId", sql.NVarChar(100), appId)
    .input("id", sql.Int, id)
    .input("userId", sql.UniqueIdentifier, userId)
    .input("userName", sql.NVarChar(150), userName)
    .query(`
      UPDATE dbo.AppVersions
      SET Status = 'discarded', DiscardedAt = SYSUTCDATETIME(), DiscardedById = @userId, DiscardedByName = @userName
      WHERE AppId = @appId AND Id = @id AND Status = 'draft'
    `);
  return result.rowsAffected[0] > 0 ? findById(appId, id) : null;
}

/** Objeto (no exports sueltos) para que las pruebas puedan simular cada función con `mock.method`. */
export const versionsRepository = { list, findById, findLatest, create, publish, discard };
