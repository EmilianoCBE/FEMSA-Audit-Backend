import { getPool, sql } from "./db/db.js";

import {
  calculateInherentRisk,
  calculateControlLevel,
  calculateVulnerability,
  calculateResidualRisk,
} from "./utils/riskMatrices.js";

const RISK_ID = 51;
const EXPECTED_PENDING = 77;

const COMMENT = "Evaluación de demostración FEMSA - prueba de mediana RSK-350022 noviembre 2026.";

// Perfiles variados. Todos los resultados se calculan con las matrices oficiales.
const profiles = [
  {
    probability: "Remota",
    impact: "Menor",
    designRating: "Optimizado",
    effectivenessRating: "Optimizado",
  },
  {
    probability: "Remota",
    impact: "Moderado",
    designRating: "Gestionado",
    effectivenessRating: "Optimizado",
  },
  {
    probability: "No probable",
    impact: "Bajo",
    designRating: "Optimizado",
    effectivenessRating: "Gestionado",
  },
  {
    probability: "No probable",
    impact: "Alto",
    designRating: "Gestionado",
    effectivenessRating: "Definido",
  },
  {
    probability: "Probable",
    impact: "Moderado",
    designRating: "Definido",
    effectivenessRating: "Funcional",
  },
  {
    probability: "Probable",
    impact: "Crítico",
    designRating: "Gestionado",
    effectivenessRating: "Funcional",
  },
  {
    probability: "Altamente probable",
    impact: "Bajo",
    designRating: "Funcional",
    effectivenessRating: "Definido",
  },
  {
    probability: "Altamente probable",
    impact: "Alto",
    designRating: "Definido",
    effectivenessRating: "Funcional",
  },
  {
    probability: "Inminente",
    impact: "Moderado",
    designRating: "Funcional",
    effectivenessRating: "Inicial",
  },
  {
    probability: "Inminente",
    impact: "Crítico",
    designRating: "Inicial",
    effectivenessRating: "Inicial",
  },
];

async function main() {
  const pool = await getPool();

  try {
    // Recuperar un usuario evaluador válido de la evaluación existente.
    const evaluatorResult = await pool.request().query(`
      SELECT TOP 1 evaluated_by_user_id
      FROM dbo.CONTROL_EVALUATION
      WHERE control_id = 48
      ORDER BY evaluated_at DESC, evaluation_id DESC;
    `);

    const evaluatorId = evaluatorResult.recordset[0]?.evaluated_by_user_id;

    if (evaluatorId == null) {
      throw new Error("No se encontró un usuario evaluador válido.");
    }

    // Recuperar únicamente los controles de RSK-350022
    // que todavía no tienen ninguna evaluación.
    const controlsResult = await pool
      .request()
      .input("riskId", sql.Int, RISK_ID)
      .query(`
        SELECT c.control_id
        FROM dbo.CONTROL c
        WHERE c.risk_id = @riskId
          AND NOT EXISTS (
            SELECT 1
            FROM dbo.CONTROL_EVALUATION ce
            WHERE ce.control_id = c.control_id
          )
        ORDER BY c.control_id;
      `);

    const controls = controlsResult.recordset;

    console.log("Riesgo: RSK-350022");
    console.log("Controles pendientes encontrados:", controls.length);

    if (controls.length !== EXPECTED_PENDING) {
      throw new Error(
        `Se esperaban ${EXPECTED_PENDING} controles pendientes, pero se encontraron ${controls.length}. No se insertó nada.`,
      );
    }

    // Calcular todas las evaluaciones antes de modificar la base.
    const evaluations = controls.map((control, index) => {
      const profile = profiles[index % profiles.length];

      const inherentLevel = calculateInherentRisk(profile.probability, profile.impact);

      const controlLevel = calculateControlLevel(profile.designRating, profile.effectivenessRating);

      const vulnerability = calculateVulnerability(inherentLevel, controlLevel);

      return {
        controlId: control.control_id,
        ...profile,
        inherentLevel,
        controlLevel,
        vulnerability,
      };
    });

    // Comprobar que las combinaciones realmente generan diversidad.
    const distribution = {};

    for (const evaluation of evaluations) {
      distribution[evaluation.vulnerability] = (distribution[evaluation.vulnerability] || 0) + 1;
    }

    console.log("\nDistribución calculada antes de insertar:");
    console.table(
      Object.entries(distribution).map(([level, total]) => ({
        vulnerabilidad: level,
        controles: total,
      })),
    );

    if (Object.keys(distribution).length < 4) {
      throw new Error("Las combinaciones no generaron al menos cuatro niveles distintos. No se insertó nada.");
    }

    // Insertar todo en una sola transacción.
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      for (const evaluation of evaluations) {
        await new sql.Request(transaction)
          .input("controlId", sql.Int, evaluation.controlId)
          .input("probability", sql.NVarChar(100), evaluation.probability)
          .input("impact", sql.NVarChar(100), evaluation.impact)
          .input("inherentLevel", sql.NVarChar(100), evaluation.inherentLevel)
          .input("designRating", sql.NVarChar(100), evaluation.designRating)
          .input("effectivenessRating", sql.NVarChar(100), evaluation.effectivenessRating)
          .input("controlLevel", sql.NVarChar(100), evaluation.controlLevel)
          .input("vulnerability", sql.NVarChar(100), evaluation.vulnerability)
          .input("evaluatorId", sql.Int, evaluatorId)
          .input("comments", sql.NVarChar(2000), COMMENT)
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
      }

      await transaction.commit();

      console.log("\n¡EVALUACIONES INSERTADAS CORRECTAMENTE!");
      console.log("Nuevas evaluaciones:", evaluations.length);
      console.log("Riesgo: RSK-350022");
    } catch (error) {
      await transaction.rollback();
      throw error;
    }

    // Consultar la última evaluación de cada uno de los 81 controles.
    const latestResult = await pool
      .request()
      .input("riskId", sql.Int, RISK_ID)
      .query(`
        SELECT
          ultima.vulnerability
        FROM dbo.CONTROL c
        OUTER APPLY (
          SELECT TOP 1
            ce.vulnerability
          FROM dbo.CONTROL_EVALUATION ce
          WHERE ce.control_id = c.control_id
          ORDER BY ce.evaluated_at DESC, ce.evaluation_id DESC
        ) ultima
        WHERE c.risk_id = @riskId
          AND ultima.vulnerability IS NOT NULL;
      `);

    const vulnerabilities = latestResult.recordset.map((row) => row.vulnerability);

    const residualRisk = calculateResidualRisk(vulnerabilities);

    console.log("\nRESULTADO DE LA MEDIANA:");
    console.log("Controles considerados:", vulnerabilities.length);
    console.log("Riesgo residual:", residualRisk);
  } finally {
    await pool.close();
  }
}

main().catch((error) => {
  console.error("\nERROR: No se completó el proceso.");
  console.error(error);
  process.exitCode = 1;
});
