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
    restoredFromNumber: row.RestoredFromNumber ?? null,
    ...(row.Config !== undefined && { config: JSON.parse(row.Config) }),
  };
}

async function list(appId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("appId", sql.NVarChar(100), appId)
    .query(`
      SELECT ${summaryColumns}
      ${fromVersions}
      WHERE v.AppId = @appId
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

/** Archiva la versión vigente y publica el borrador indicado, en una transacción. */
async function publish(appId, id) {
  const pool = await getPool();
  await pool
    .request()
    .input("appId", sql.NVarChar(100), appId)
    .input("id", sql.Int, id)
    .query(`
      SET XACT_ABORT ON;
      BEGIN TRANSACTION;

      UPDATE dbo.AppVersions
      SET Status = 'archived'
      WHERE AppId = @appId AND Status = 'current';

      UPDATE dbo.AppVersions
      SET Status = 'current', PublishedAt = SYSUTCDATETIME()
      WHERE AppId = @appId AND Id = @id AND Status = 'draft';

      COMMIT TRANSACTION;
    `);
  return findById(appId, id);
}

/** Objeto (no exports sueltos) para que las pruebas puedan simular cada función con `mock.method`. */
export const versionsRepository = { list, findById, create, publish };
