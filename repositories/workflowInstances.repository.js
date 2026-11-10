// Fase 4 del workflow - Emiliano Carrizales: acceso a dbo.AppWorkflowInstances y dbo.AppWorkflowHistory (solo SQL).
import { getPool, sql } from "../db/db.js";

const parseJson = (value) => (value ? JSON.parse(value) : null);

const instanceColumns = `
  i.Id, i.AppId, i.AppVersionId, v.VersionNumber, v.Status AS VersionStatus, i.Title, i.CurrentStateId, i.Status,
  i.StateEnteredAt, i.StartedById, i.StartedByName, i.StartedAt, i.CompletedAt`;
const fromInstances = "FROM dbo.AppWorkflowInstances i JOIN dbo.AppVersions v ON v.Id = i.AppVersionId";

function toInstance(row) {
  return {
    id: row.Id,
    appId: row.AppId,
    appVersionId: row.AppVersionId,
    versionNumber: row.VersionNumber,
    versionStatus: row.VersionStatus,
    title: row.Title,
    currentStateId: row.CurrentStateId,
    status: row.Status,
    stateEnteredAt: row.StateEnteredAt,
    startedById: row.StartedById,
    startedByName: row.StartedByName,
    startedAt: row.StartedAt,
    completedAt: row.CompletedAt,
  };
}

function toHistory(row) {
  return {
    id: row.Id,
    transitionId: row.TransitionId,
    action: row.Action,
    fromStateId: row.FromStateId,
    toStateId: row.ToStateId,
    actorId: row.ActorId,
    actorName: row.ActorName,
    actorRole: row.ActorRole,
    comment: row.Comment,
    evidence: row.Evidence,
    actionPlan: parseJson(row.ActionPlan),
    at: row.At,
  };
}

/** Crea el proceso anclado a la versión y su registro de inicio, en una sola transacción. */
async function create({ appId, appVersionId, title, initialStateId, actor }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("appId", sql.NVarChar(100), appId)
    .input("appVersionId", sql.Int, appVersionId)
    .input("title", sql.NVarChar(200), title)
    .input("state", sql.NVarChar(60), initialStateId)
    .input("actorId", sql.UniqueIdentifier, actor.id)
    .input("actorName", sql.NVarChar(150), actor.name)
    .input("actorRole", sql.NVarChar(60), actor.workflowRole ?? null)
    .query(`
      SET XACT_ABORT ON;
      BEGIN TRANSACTION;
      DECLARE @id UNIQUEIDENTIFIER = NEWID();
      INSERT INTO dbo.AppWorkflowInstances (Id, AppId, AppVersionId, Title, CurrentStateId, StartedById, StartedByName)
      VALUES (@id, @appId, @appVersionId, @title, @state, @actorId, @actorName);
      INSERT INTO dbo.AppWorkflowHistory (InstanceId, Action, ToStateId, ActorId, ActorName, ActorRole)
      VALUES (@id, N'iniciar', @state, @actorId, @actorName, @actorRole);
      COMMIT TRANSACTION;
      SELECT ${instanceColumns} ${fromInstances} WHERE i.Id = @id;
    `);
  return toInstance(result.recordset[0]);
}

async function list(appId, status) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("appId", sql.NVarChar(100), appId)
    .input("status", sql.VarChar(10), status ?? null)
    .query(`
      SELECT ${instanceColumns} ${fromInstances}
      WHERE i.AppId = @appId AND (@status IS NULL OR i.Status = @status)
      ORDER BY i.Status, i.StartedAt DESC;
    `);
  return result.recordset.map(toInstance);
}

async function findById(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("id", sql.UniqueIdentifier, id)
    .query(`SELECT ${instanceColumns} ${fromInstances} WHERE i.Id = @id;`);
  const row = result.recordset[0];
  return row ? toInstance(row) : null;
}

async function history(instanceId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("id", sql.UniqueIdentifier, instanceId)
    .query("SELECT * FROM dbo.AppWorkflowHistory WHERE InstanceId = @id ORDER BY Id;");
  return result.recordset.map(toHistory);
}

/**
 * Mueve el proceso solo si sigue en el estado de origen (si otra persona lo movió antes, no hace nada y regresa
 * null) y deja el registro en el historial, en una sola transacción.
 */
async function transition(
  id,
  { transitionId, action, fromStateId, toStateId, completes, actor, comment, evidence, actionPlan },
) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("id", sql.UniqueIdentifier, id)
    .input("transitionId", sql.NVarChar(60), transitionId)
    .input("action", sql.NVarChar(60), action)
    .input("from", sql.NVarChar(60), fromStateId)
    .input("to", sql.NVarChar(60), toStateId)
    .input("completes", sql.Bit, completes ? 1 : 0)
    .input("actorId", sql.UniqueIdentifier, actor.id)
    .input("actorName", sql.NVarChar(150), actor.name)
    .input("actorRole", sql.NVarChar(60), actor.workflowRole ?? null)
    .input("comment", sql.NVarChar(1000), comment ?? null)
    .input("evidence", sql.NVarChar(500), evidence ?? null)
    .input("actionPlan", sql.NVarChar(sql.MAX), actionPlan ? JSON.stringify(actionPlan) : null)
    .query(`
      SET XACT_ABORT ON;
      BEGIN TRANSACTION;
      UPDATE dbo.AppWorkflowInstances
      SET CurrentStateId = @to,
          StateEnteredAt = SYSUTCDATETIME(),
          Status = CASE WHEN @completes = 1 THEN 'completed' ELSE 'active' END,
          CompletedAt = CASE WHEN @completes = 1 THEN SYSUTCDATETIME() ELSE NULL END
      WHERE Id = @id AND Status = 'active' AND CurrentStateId = @from;
      IF @@ROWCOUNT = 0
      BEGIN
        ROLLBACK TRANSACTION;
        SELECT CAST(0 AS BIT) AS Moved;
        RETURN;
      END;
      INSERT INTO dbo.AppWorkflowHistory
        (InstanceId, TransitionId, Action, FromStateId, ToStateId, ActorId, ActorName, ActorRole, Comment, Evidence, ActionPlan)
      VALUES (@id, @transitionId, @action, @from, @to, @actorId, @actorName, @actorRole, @comment, @evidence, @actionPlan);
      COMMIT TRANSACTION;
      SELECT CAST(1 AS BIT) AS Moved;
    `);
  return result.recordset[0]?.Moved ? findById(id) : null;
}

/** Procesos en curso por versión de un formulario (para avisar al publicar una versión nueva). */
async function activeByVersion(appId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("appId", sql.NVarChar(100), appId)
    .query(`
      SELECT v.Id AS AppVersionId, v.VersionNumber, COUNT(*) AS Total
      ${fromInstances}
      WHERE i.AppId = @appId AND i.Status = 'active'
      GROUP BY v.Id, v.VersionNumber
      ORDER BY v.VersionNumber;
    `);
  return result.recordset.map((row) => ({
    appVersionId: row.AppVersionId,
    versionNumber: row.VersionNumber,
    active: row.Total,
  }));
}

/** Objeto (no exports sueltos) para que las pruebas puedan simular cada función con `mock.method`. */
export const workflowInstancesRepository = { create, list, findById, history, transition, activeByVersion };
