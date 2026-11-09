
import {
  findRisksWithControls,
  findRiskWithControls,
  findControlEvaluationHistory,
  createControlEvaluation,
} from "../models/controlEvaluation.model.js";

import {
  calculateInherentRisk,
  calculateControlLevel,
  calculateVulnerability,
  calculateResidualRisk,
} from "../utils/riskMatrices.js";

import { HttpError } from "../utils/httpErrors.js";

const PROBABILITIES = [
  "Inminente",
  "Altamente probable",
  "Probable",
  "No probable",
  "Remota",
];

const IMPACTS = [
  "Menor",
  "Bajo",
  "Moderado",
  "Alto",
  "Crítico",
];

const CONTROL_RATINGS = [
  "Inicial",
  "Funcional",
  "Definido",
  "Gestionado",
  "Optimizado",
];

/**
 * Convierte los campos organizacionales del modelo
 * a propiedades camelCase para el frontend.
 */
function mapCatalogInfo(record) {
  return {
    catalogCodes: record.catalog_codes ?? null,
    auditDepartments: record.audit_departments ?? null,
    auditDomains: record.audit_domains ?? null,
    businessUnits: record.business_units ?? null,
    divisions: record.divisions ?? null,
    subdivisions: record.subdivisions ?? null,
    areas: record.areas ?? null,
    countries: record.countries ?? null,
  };
}

/**
 * GET /api/control-evaluations/risks
 * Devuelve los riesgos registrados y sus controles asociados,
 * incluyendo la información organizacional del catálogo.
 */
export async function getRisksWithControlsController(req, res) {
  const records = await findRisksWithControls();

  const risksMap = new Map();

  for (const record of records) {
    if (!risksMap.has(record.risk_id)) {
      risksMap.set(record.risk_id, {
        riskId: record.risk_id,
        trackingId: record.risk_tracking_id,
        name: record.risk_name,
        category: record.category,
        inherentLevel: record.inherent_level,
        controls: [],
        vulnerabilities: [],
      });
    }

    const risk = risksMap.get(record.risk_id);

    if (record.control_id !== null) {
      risk.controls.push({
        controlId: record.control_id,
        trackingId: record.control_tracking_id,
        name: record.control_name,
        domain: record.domain,
        ...mapCatalogInfo(record),
      });

      if (record.latest_vulnerability) {
        risk.vulnerabilities.push(record.latest_vulnerability);
      }
    }
  }

  const risks = Array.from(risksMap.values()).map((risk) => {
    const residualRisk = calculateResidualRisk(risk.vulnerabilities);

    const {
      vulnerabilities,
      ...riskData
    } = risk;

    return {
      ...riskData,
      residualRisk,
    };
  });

  res.json({ risks });
}

/**
 * GET /api/control-evaluations/risk/:riskId
 * Devuelve un riesgo, sus controles y la última evaluación
 * disponible de cada control.
 *
 * El riesgo residual se calcula con la mediana de las
 * últimas vulnerabilidades disponibles.
 */
export async function getRiskWithControlsController(req, res) {
  const riskId = req.params.riskId?.trim();

  if (!riskId || riskId.length > 30) {
    throw new HttpError(
      400,
      "El identificador del riesgo no es válido."
    );
  }

  const records = await findRiskWithControls(riskId);

  if (records.length === 0) {
    throw new HttpError(
      404,
      "El riesgo seleccionado no existe."
    );
  }

  const firstRecord = records[0];

  const controls = records
    .filter(record => record.control_id !== null)
    .map(record => ({
      controlId: record.control_id,
      trackingId: record.control_tracking_id,
      name: record.control_name,
      domain: record.domain,
      ...mapCatalogInfo(record),
      latestEvaluation: record.evaluation_id
        ? {
            evaluationId: record.evaluation_id,
            probability: record.probability,
            impact: record.impact,
            inherentLevel: record.evaluated_inherent_level,
            designRating: record.design_rating,
            effectivenessRating: record.effectiveness_rating,
            controlLevel: record.control_level,
            vulnerability: record.vulnerability,
            evaluatedAt: record.evaluated_at,
            comments: record.comments,
            evaluatedByUserId: record.evaluated_by_user_id,
            evaluatedByUserName: record.evaluated_by_user_name,
          }
        : null,
    }));

  // Solo se considera la última evaluación de cada control.
  // Los controles que nunca se han evaluado quedan excluidos.
  const vulnerabilities = controls
    .map(control => control.latestEvaluation?.vulnerability)
    .filter(Boolean);

  const residualRisk = calculateResidualRisk(vulnerabilities);

  res.json({
    risk: {
      riskId: firstRecord.risk_id,
      trackingId: firstRecord.risk_tracking_id,
      name: firstRecord.risk_name,
      category: firstRecord.category,
      inherentLevel: firstRecord.inherent_level,
    },
    controls,
    residualRisk,
  });
}

/**
 * GET /api/control-evaluations/control/:controlId
 * Devuelve el historial completo de evaluaciones de un control,
 * incluyendo su información organizacional.
 */
export async function getControlEvaluationHistoryController(req, res) {
  const rawControlId = req.params.controlId;

  if (
    typeof rawControlId !== "string" ||
    !/^[1-9]\d*$/.test(rawControlId) ||
    !Number.isSafeInteger(Number(rawControlId))
  ) {
    throw new HttpError(
      400,
      "El identificador del control debe ser un entero positivo."
    );
  }

  const controlId = Number(rawControlId);
  const records = await findControlEvaluationHistory(controlId);

  if (records.length === 0) {
    throw new HttpError(
      404,
      "El control seleccionado no existe."
    );
  }

  const firstRecord = records[0];

  const evaluations = records
    .filter(record => record.evaluation_id !== null)
    .map(record => ({
      evaluationId: record.evaluation_id,
      probability: record.probability,
      impact: record.impact,
      inherentLevel: record.inherent_level,
      designRating: record.design_rating,
      effectivenessRating: record.effectiveness_rating,
      controlLevel: record.control_level,
      vulnerability: record.vulnerability,
      evaluatedByUserId: record.evaluated_by_user_id,
      evaluatedByUserName: record.evaluated_by_user_name,
      evaluatedAt: record.evaluated_at,
      comments: record.comments,
    }));

  res.json({
    control: {
      controlId: firstRecord.control_id,
      trackingId: firstRecord.control_tracking_id,
      name: firstRecord.control_name,
      ...mapCatalogInfo(firstRecord),
    },
    risk: {
      riskId: firstRecord.risk_id,
      trackingId: firstRecord.risk_tracking_id,
      name: firstRecord.risk_name,
    },
    evaluations,
    count: evaluations.length,
  });
}

/**
 * POST /api/control-evaluations
 * Registra una nueva evaluación de un control.
 *
 * El backend calcula los resultados mediante las matrices oficiales.
 * No confía en resultados calculados por el frontend.
 */
export async function createControlEvaluationController(req, res) {
  const {
    controlId,
    probability,
    impact,
    designRating,
    effectivenessRating,
    comments,
  } = req.body ?? {};

  // Validar el identificador del control.
  if (
    !Number.isSafeInteger(Number(controlId)) ||
    Number(controlId) <= 0 ||
    String(controlId).trim() === ""
  ) {
    throw new HttpError(
      400,
      "Debes seleccionar un control válido."
    );
  }

  const numericControlId = Number(controlId);

  // Validar probabilidad.
  if (!PROBABILITIES.includes(probability)) {
    throw new HttpError(
      400,
      "La probabilidad seleccionada no es válida."
    );
  }

  // Validar impacto.
  if (!IMPACTS.includes(impact)) {
    throw new HttpError(
      400,
      "El impacto seleccionado no es válido."
    );
  }

  // Validar diseño del control.
  if (!CONTROL_RATINGS.includes(designRating)) {
    throw new HttpError(
      400,
      "La calificación del diseño no es válida."
    );
  }

  // Validar efectividad del control.
  if (!CONTROL_RATINGS.includes(effectivenessRating)) {
    throw new HttpError(
      400,
      "La calificación de efectividad no es válida."
    );
  }

  // Validar comentarios opcionales.
  if (
    comments !== undefined &&
    comments !== null &&
    (
      typeof comments !== "string" ||
      comments.length > 2000
    )
  ) {
    throw new HttpError(
      400,
      "Los comentarios deben ser texto y no superar 2000 caracteres."
    );
  }

  // Identificar al usuario autenticado mediante su UUID de sesión.
  const authUserId = req.user?.id;

  if (
    typeof authUserId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(authUserId)
  ) {
    throw new HttpError(
      401,
      "No se pudo identificar al usuario autenticado."
    );
  }

  // Calcular los resultados con las matrices oficiales de FEMSA.
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

  // Guardar una nueva evaluación.
  const evaluation = await createControlEvaluation({
    controlId: numericControlId,
    probability,
    impact,
    inherentLevel,
    designRating,
    effectivenessRating,
    controlLevel,
    vulnerability,
    authUserId,
    comments: comments?.trim() || null,
  });

  if (evaluation?.error === "USER_NOT_FOUND") {
    throw new HttpError(
      403,
      "No se pudo asociar la evaluación con un usuario activo."
    );
  }

  if (evaluation?.error === "CONTROL_NOT_FOUND") {
    throw new HttpError(
      404,
      "El control seleccionado no existe."
    );
  }

  res.status(201).json({
    message: "Evaluación del control guardada correctamente.",
    evaluation,
  });
}
