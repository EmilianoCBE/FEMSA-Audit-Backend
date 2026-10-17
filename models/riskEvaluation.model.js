
import { getPool, sql } from '../db/db.js';

export async function createRiskEvaluation({
  riskLibraryId,
  probability,
  impact,
  score,
  level,
  authUserId,
}) {
  const pool = await getPool();

  const result = await pool
    .request()
    .input('riskLibraryId', sql.VarChar(30), riskLibraryId)
    .input('probability', sql.TinyInt, probability)
    .input('impact', sql.TinyInt, impact)
    .input('score', sql.Int, score)
    .input('level', sql.NVarChar(20), level)
    .input('authUserId', sql.UniqueIdentifier, authUserId)
    .query(`
      INSERT INTO dbo.RISK_EVALUATION (
        risk_library_id,
        probability,
        impact,
        risk_score,
        risk_level,
        evaluated_by_user_id
      )
      OUTPUT
        inserted.evaluation_id,
        inserted.risk_library_id,
        inserted.probability,
        inserted.impact,
        inserted.risk_score,
        inserted.risk_level,
        inserted.evaluated_by_user_id,
        inserted.created_at
      SELECT
        rl.risk_library_id,
        @probability,
        @impact,
        @score,
        @level,
        u.user_id
      FROM dbo.RISK_LIBRARY AS rl
      INNER JOIN dbo.AuthUsers AS a
        ON a.Id = @authUserId
      INNER JOIN dbo.[USER] AS u
        ON u.user_id = a.UserId
      WHERE rl.risk_library_id = @riskLibraryId
        AND a.IsActive = 1
        AND u.is_active = 1;
    `);

  return result.recordset[0] ?? null;
}
