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
    change: parseJson(row.ProposedChange) ?? undefined,
    status: row.Status,
    appliedChange: parseJson(row.AppliedChange),
    createdAt: row.CreatedAt,
    decidedAt: row.DecidedAt,
  };
}

/** Guarda todas las sugerencias de un análisis en una sola sentencia y las regresa en el mismo orden, con su id. */
async function createMany({ appId, analysisId, suggestions, provider, promptVersion, latencyMs, requestedBy }) {
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
  }));

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
         Provider, PromptVersion, LatencyMs, RequestedBy)
      SELECT @appId, @analysisId, j.source, j.kind, j.title, j.reason, j.confidence, j.fieldId, j.change,
             @provider, @promptVersion, @latencyMs, @requestedBy
      FROM OPENJSON(@rows) WITH (
        ord INT '$.ord',
        source VARCHAR(10) '$.source',
        kind VARCHAR(20) '$.kind',
        title NVARCHAR(160) '$.title',
        reason NVARCHAR(600) '$.reason',
        confidence VARCHAR(5) '$.confidence',
        fieldId NVARCHAR(100) '$.fieldId',
        change NVARCHAR(MAX) '$.change'
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

/** Conteos por origen y estado, y latencia promedio de la IA, para medir el asistente. */
async function metrics(appId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("appId", sql.NVarChar(100), appId)
    .query(`
      SELECT Source, Status, COUNT(*) AS Total, AVG(CAST(LatencyMs AS FLOAT)) AS AvgLatencyMs
      FROM dbo.AppAiRecommendations
      WHERE AppId = @appId
      GROUP BY Source, Status;
    `);
  return result.recordset.map((row) => ({
    source: row.Source,
    status: row.Status,
    total: row.Total,
    avgLatencyMs: row.AvgLatencyMs,
  }));
}

/** Objeto (no exports sueltos) para que las pruebas puedan simular cada función con `mock.method`. */
export const aiRecommendationsRepository = { createMany, findById, decide, metrics };
