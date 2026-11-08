
import { getPool, sql } from "./db/db.js";
import {
  calculateInherentRisk,
  calculateControlLevel,
  calculateVulnerability,
} from "./utils/riskMatrices.js";

const groups = [
  { riskId: 23, ids: [89] },
  { riskId: 24, ids: [220] },
  { riskId: 25, ids: [243] },

  { riskId: 26, ids: [253, 254] },
  { riskId: 27, ids: [265, 266] },
  { riskId: 28, ids: [275, 276] },
  { riskId: 29, ids: [468, 469] },

  { riskId: 30, ids: [473, 474, 475] },
  { riskId: 31, ids: [481, 482, 483] },
  { riskId: 32, ids: [491, 492, 493] },
  { riskId: 33, ids: [294, 295, 296] },
  { riskId: 46, ids: [109, 110, 1649] },
  { riskId: 47, ids: [111, 112, 1254] },

  { riskId: 49, ids: [317, 318, 319, 320] },
  { riskId: 50, ids: [640, 852, 1256, 1652] },
  { riskId: 51, ids: [49, 51, 52, 53] },
];

const comment =
  "Evaluación de demostración FEMSA - lote de pruebas noviembre 2026.";

async function main() {
  const pool = await getPool();

  try {
    const evaluatorResult = await pool.request().query(`
      SELECT TOP 1 evaluated_by_user_id
      FROM dbo.CONTROL_EVALUATION
      WHERE control_id = 48
      ORDER BY evaluated_at DESC, evaluation_id DESC;
    `);

    const evaluatorId =
      evaluatorResult.recordset[0]?.evaluated_by_user_id;

    if (evaluatorId == null) {
      throw new Error(
        "No se encontró un usuario evaluador válido en la evaluación existente del control 48."
      );
    }

    const controls = groups.flatMap((group) =>
      group.ids.map((controlId) => ({
        riskId: group.riskId,
        controlId,
      }))
    );

    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      const inserted = [];

      for (const item of controls) {
        const check = await new sql.Request(transaction)
          .input("controlId", sql.Int, item.controlId)
          .input("riskId", sql.Int, item.riskId)
          .query(`
            SELECT
              c.control_id,
              c.risk_id,
              r.inherent_level
            FROM dbo.CONTROL c
            INNER JOIN dbo.RISK r
              ON r.risk_id = c.risk_id
            WHERE c.control_id = @controlId
              AND c.risk_id = @riskId;
          `);

        if (check.recordset.length !== 1) {
          throw new Error(
            `El control ${item.controlId} no existe o no pertenece al riesgo ${item.riskId}.`
          );
        }

        const existing = await new sql.Request(transaction)
          .input("controlId", sql.Int, item.controlId)
          .query(`
            SELECT COUNT(*) AS total
            FROM dbo.CONTROL_EVALUATION
            WHERE control_id = @controlId;
          `);

        if (existing.recordset[0].total > 0) {
          throw new Error(
            `El control ${item.controlId} ya tiene evaluaciones. Se cancela el lote para evitar duplicados.`
          );
        }

        const probability = "Probable";
        const impact = "Moderado";
        const designRating = "Definido";
        const effectivenessRating = "Funcional";

        const inherentLevel = calculateInherentRisk(
          probability,
          impact
        );

        const controlLevel = calculateControlLevel(
          designRating,
          effectivenessRating
        );

        const vulnerability = calculateVulnerability(
          inherentLevel,
          controlLevel
        );

        const result = await new sql.Request(transaction)
          .input("controlId", sql.Int, item.controlId)
          .input("probability", sql.NVarChar(100), probability)
          .input("impact", sql.NVarChar(100), impact)
          .input("inherentLevel", sql.NVarChar(100), inherentLevel)
          .input("designRating", sql.NVarChar(100), designRating)
          .input(
            "effectivenessRating",
            sql.NVarChar(100),
            effectivenessRating
          )
          .input("controlLevel", sql.NVarChar(100), controlLevel)
          .input("vulnerability", sql.NVarChar(100), vulnerability)
          .input("evaluatorId", sql.Int, evaluatorId)
          .input("comments", sql.NVarChar(2000), comment)
          .query(`
            INSERT INTO dbo.CONTROL_EVALUATION (
              control_id,
              probability,
              impact,
              inherent_level,
              design_rating,
              effectiveness_rating,
              control_level,
              vulnerability,
              evaluated_by_user_id,
              comments
            )
            OUTPUT
              INSERTED.evaluation_id,
              INSERTED.control_id,
              INSERTED.vulnerability
            VALUES (
              @controlId,
              @probability,
              @impact,
              @inherentLevel,
              @designRating,
              @effectivenessRating,
              @controlLevel,
              @vulnerability,
              @evaluatorId,
              @comments
            );
          `);

        inserted.push({
          riskId: item.riskId,
          controlId: item.controlId,
          ...result.recordset[0],
        });
      }

      await transaction.commit();

      console.log("\n¡LOTE INSERTADO CORRECTAMENTE!");
      console.log(`Evaluaciones nuevas: ${inserted.length}`);
      console.table(inserted);
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } finally {
    await pool.close();
  }
}

main().catch((error) => {
  console.error("\nERROR: No se completó el lote.");
  console.error(error);
  process.exitCode = 1;
});
