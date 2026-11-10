// US15-US17 - Emiliano Carrizales: acceso a dbo.AppAiRecommendations (solo SQL, sin reglas de negocio).
import { getPool, sql } from "../db/db.js";

const parseJson = (value) => (value ? JSON.parse(value) : null);

function toRecommendation(row) {
  return {
    id: String(row.Id),
    appId: row.AppId,
    analysisId: row.AnalysisId,
    source: row.Source,
    kind: row.Kind,
    title: row.Title,
    reason: row.Reason,
    confidence: row.Confidence,
    fieldId: row.FieldId ?? undefined,
    // Antes de la migración 006 no existen Scope ni Target: todo era del Designer.
    scope: row.Scope ?? "designer",
    target: parseJson(row.Target) ?? undefined,
    change: parseJson(row.ProposedChange) ?? undefined,
    status: row.Status,
    appliedChange: parseJson(row.AppliedChange),
    createdAt: row.CreatedAt,
    decidedAt: row.DecidedAt,
  };
}

/**
 * Guarda todas las sugerencias de un análisis en una sola sentencia y las regresa en el mismo orden, con su id.
 * `scope: "workflow"` usa las columnas de la migración 006; el Designer sigue funcionando sin ella.
 */
async function createMany({
  appId,
  analysisId,
  suggestions,
  provider,
  promptVersion,
  latencyMs,
  requestedBy,
  scope = "designer",
}) {
  if (suggestions.length === 0) return [];
  const rows = suggestions.map((suggestion, ord) => ({
    ord,
    source: suggestion.source,
    kind: suggestion.kind,
    title: suggestion.title,
    reason: suggestion.reason,
    confidence: suggestion.confidence,
    fieldId: suggestion.fieldId ?? null,
    change: suggestion.change ? JSON.stringify(suggestion.change) : null,
    target: suggestion.target ? JSON.stringify(suggestion.target) : null,
  }));
  const workflow = scope === "workflow";

  const pool = await getPool();
  const result = await pool
    .request()
    .input("appId", sql.NVarChar(100), appId)
    .input("analysisId", sql.UniqueIdentifier, analysisId)
    .input("rows", sql.NVarChar(sql.MAX), JSON.stringify(rows))
    .input("provider", sql.VarChar(30), provider)
    .input("promptVersion", sql.VarChar(40), promptVersion)
    .input("latencyMs", sql.Int, latencyMs)
    .input("requestedBy", sql.UniqueIdentifier, requestedBy ?? null)
    .query(`
      INSERT INTO dbo.AppAiRecommendations
        (AppId, AnalysisId, Source, Kind, Title, Reason, Confidence, FieldId, ProposedChange,
         Provider, PromptVersion, LatencyMs, RequestedBy${workflow ? ", Scope, Target" : ""})
      SELECT @appId, @analysisId, j.source, j.kind, j.title, j.reason, j.confidence, j.fieldId, j.change,
             @provider, @promptVersion, @latencyMs, @requestedBy${workflow ? ", 'workflow', j.target" : ""}
      FROM OPENJSON(@rows) WITH (
        ord INT '$.ord',
        source VARCHAR(10) '$.source',
        kind VARCHAR(20) '$.kind',
        title NVARCHAR(160) '$.title',
        reason NVARCHAR(600) '$.reason',
        confidence VARCHAR(5) '$.confidence',
        fieldId NVARCHAR(100) '$.fieldId',
        change NVARCHAR(MAX) '$.change',
        target NVARCHAR(300) '$.target'
      ) AS j
      ORDER BY j.ord;

      SELECT * FROM dbo.AppAiRecommendations WHERE AnalysisId = @analysisId ORDER BY Id;
    `);
  return result.recordset.map(toRecommendation);
}

async function findById(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("id", sql.Int, id)
    .query("SELECT * FROM dbo.AppAiRecommendations WHERE Id = @id");
  const row = result.recordset[0];
  return row ? toRecommendation(row) : null;
}

/** Registra la decisión solo si sigue pendiente; regresa null si ya estaba decidida o no existe. */
async function decide(id, { status, appliedChange, decidedBy }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("id", sql.Int, id)
    .input("status", sql.VarChar(10), status)
    .input("appliedChange", sql.NVarChar(sql.MAX), appliedChange ? JSON.stringify(appliedChange) : null)
    .input("decidedBy", sql.UniqueIdentifier, decidedBy ?? null)
    .query(`
      UPDATE dbo.AppAiRecommendations
      SET Status = @status, AppliedChange = @appliedChange, DecidedBy = @decidedBy, DecidedAt = SYSUTCDATETIME()
      OUTPUT INSERTED.*
      WHERE Id = @id AND Status = 'pending';
    `);
  const row = result.recordset[0];
  return row ? toRecommendation(row) : null;
}

/**
 * Fase 3 del workflow: guarda una sugerencia de las reglas del flujo junto con la decisión del usuario. Las reglas del
 * flujo corren en el navegador, así que solo llegan aquí cuando alguien las decide.
 */
async function createDecided({ appId, suggestion, status, appliedChange, decidedBy, provider, promptVersion }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("appId", sql.NVarChar(100), appId)
    .input("kind", sql.VarChar(20), suggestion.kind)
    .input("title", sql.NVarChar(160), suggestion.title)
    .input("reason", sql.NVarChar(600), suggestion.reason)
    .input("confidence", sql.VarChar(5), suggestion.confidence)
    .input("change", sql.NVarChar(sql.MAX), suggestion.change ? JSON.stringify(suggestion.change) : null)
    .input("target", sql.NVarChar(300), suggestion.target ? JSON.stringify(suggestion.target) : null)
    .input("status", sql.VarChar(10), status)
    .input("appliedChange", sql.NVarChar(sql.MAX), appliedChange ? JSON.stringify(appliedChange) : null)
    .input("provider", sql.VarChar(30), provider)
    .input("promptVersion", sql.VarChar(40), promptVersion)
    .input("decidedBy", sql.UniqueIdentifier, decidedBy ?? null)
    .query(`
      INSERT INTO dbo.AppAiRecommendations
        (AppId, AnalysisId, Source, Kind, Title, Reason, Confidence, ProposedChange, AppliedChange, Status,
         Provider, PromptVersion, RequestedBy, DecidedBy, DecidedAt, Scope, Target)
      OUTPUT INSERTED.*
      VALUES (@appId, NEWID(), 'rules', @kind, @title, @reason, @confidence, @change, @appliedChange, @status,
              @provider, @promptVersion, @decidedBy, @decidedBy, SYSUTCDATETIME(), 'workflow', @target);
    `);
  return toRecommendation(result.recordset[0]);
}

/**
 * Conteos por origen y estado, y latencia promedio de la IA, para medir el asistente de una pantalla.
 * Sin la migración 006 no hay columna Scope: todo cuenta como Designer y el flujo no tiene registros.
 */
async function metrics(appId, scope = "designer") {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("appId", sql.NVarChar(100), appId)
    .input("scope", sql.VarChar(10), scope)
    .query(`
      IF COL_LENGTH('dbo.AppAiRecommendations', 'Scope') IS NULL
      BEGIN
        IF @scope = 'workflow'
          THROW 50206, 'Invalid column name ''Scope'' (falta la migración 006).', 1;
        SELECT Source, Status, COUNT(*) AS Total, AVG(CAST(LatencyMs AS FLOAT)) AS AvgLatencyMs
        FROM dbo.AppAiRecommendations
        WHERE AppId = @appId
        GROUP BY Source, Status;
      END
      ELSE
        EXEC sp_executesql
          N'SELECT Source, Status, COUNT(*) AS Total, AVG(CAST(LatencyMs AS FLOAT)) AS AvgLatencyMs
            FROM dbo.AppAiRecommendations
            WHERE AppId = @appId AND Scope = @scope
            GROUP BY Source, Status;',
          N'@appId NVARCHAR(100), @scope VARCHAR(10)', @appId, @scope;
    `);
  return result.recordset.map((row) => ({
    source: row.Source,
    status: row.Status,
    total: row.Total,
    avgLatencyMs: row.AvgLatencyMs,
  }));
}

/** Objeto (no exports sueltos) para que las pruebas puedan simular cada función con `mock.method`. */
export const aiRecommendationsRepository = { createMany, createDecided, findById, decide, metrics };
