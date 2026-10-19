import { classifyRisk } from '../models/risk.model.js';
import { findRiskLibraryById } from '../models/riskLibrary.model.js';
import {
  createRiskEvaluation,
  getRiskEvaluations,
  getRiskEvaluationSummary,
  getEvaluationsForRisk,
  getRiskEvaluationsByRiskId,
} from '../models/riskEvaluation.model.js';
import { HttpError } from '../utils/httpErrors.js';



export async function createRiskEvaluationController(req, res) {
  const {
    riskLibraryId,
    probability,
    impact,
  } = req.body ?? {};

  if (
    typeof riskLibraryId !== 'string' ||
    !riskLibraryId.trim()
  ) {
    throw new HttpError(
      400,
      'Debes seleccionar un riesgo del catálogo.'
    );
  }

  const numericProbability = Number(probability);
  const numericImpact = Number(impact);

  if (
    !Number.isInteger(numericProbability) ||
    numericProbability < 1 ||
    numericProbability > 5
  ) {
    throw new HttpError(
      400,
      'La probabilidad debe ser un número entero entre 1 y 5.'
    );
  }

  if (
    !Number.isInteger(numericImpact) ||
    numericImpact < 1 ||
    numericImpact > 5
  ) {
    throw new HttpError(
      400,
      'El impacto debe ser un número entero entre 1 y 5.'
    );
  }

  const riskId = riskLibraryId.trim();
  const risk = await findRiskLibraryById(riskId);

  if (!risk) {
    throw new HttpError(
      404,
      'El riesgo seleccionado no existe en el catálogo.'
    );
  }



const authUserId = req.user?.id;

    if (
    typeof authUserId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(authUserId)
    ) {
    throw new HttpError(
        401,
        'No se pudo identificar al usuario autenticado.'
    );
}



  // El backend calcula el resultado; no confía en un score del cliente.
  const classification = classifyRisk(
    numericProbability,
    numericImpact
  );

  const evaluation = await createRiskEvaluation({
    riskLibraryId: riskId,
    probability: numericProbability,
    impact: numericImpact,
    score: classification.score,
    level: classification.level,
    authUserId,
  });

  if (!evaluation) {
    throw new HttpError(
      403,
      'No se pudo asociar la evaluación con el usuario activo.'
    );
  }

  res.status(201).json({
    message: 'Evaluación guardada correctamente.',
    evaluation,
  });
}


function readEvaluationFilters(query) {
  const search = typeof query.search === "string"
    ? query.search.trim()
    : "";

  const department = typeof query.department === "string"
    ? query.department.trim()
    : "";

  const level = typeof query.level === "string"
    ? query.level.trim()
    : "";

  if (search.length > 200) {
    throw new HttpError(400, "La búsqueda no puede superar 200 caracteres.");
  }

  if (department.length > 100) {
    throw new HttpError(400, "El departamento no es válido.");
  }

  const validLevels = ["Bajo", "Medio", "Alto", "Crítico"];

  if (level && !validLevels.includes(level)) {
    throw new HttpError(400, "El nivel de riesgo no es válido.");
  }

  function parseDate(value, fieldName) {
    if (value === undefined || value === "") return null;

    if (
      typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value)
    ) {
      throw new HttpError(400, `La fecha ${fieldName} debe usar el formato YYYY-MM-DD.`);
    }

    const date = new Date(`${value}T00:00:00.000Z`);

    if (
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== value
    ) {
      throw new HttpError(400, `La fecha ${fieldName} no es válida.`);
    }

    return date;
  }

  const fromDate = parseDate(query.fromDate, "inicial");
  const selectedToDate = parseDate(query.toDate, "final");

  if (fromDate && selectedToDate && fromDate > selectedToDate) {
    throw new HttpError(
      400,
      "La fecha inicial no puede ser posterior a la fecha final."
    );
  }

  // La fecha final se interpreta como un día completo.
  const toDate = selectedToDate
    ? new Date(selectedToDate.getTime() + 24 * 60 * 60 * 1000)
    : null;

  return {
    search,
    department,
    level,
    fromDate,
    toDate,
  };
}

export async function getRiskEvaluationsController(req, res) {
  const pageRaw = req.query.page ?? "1";
  const pageSizeRaw =
    req.query.pageSize ?? req.query.limit ?? "5";

  if (
    typeof pageRaw !== "string" ||
    !/^[1-9]\d*$/.test(pageRaw) ||
    !Number.isSafeInteger(Number(pageRaw))
  ) {
    throw new HttpError(400, "La página debe ser un entero positivo.");
  }

  if (
    typeof pageSizeRaw !== "string" ||
    !/^[1-9]\d*$/.test(pageSizeRaw) ||
    !Number.isSafeInteger(Number(pageSizeRaw)) ||
    Number(pageSizeRaw) > 100
  ) {
    throw new HttpError(
      400,
      "El tamaño de página debe ser un entero entre 1 y 100."
    );
  }

  const page = Number(pageRaw);
  const pageSize = Number(pageSizeRaw);
  const filters = readEvaluationFilters(req.query);

  const result = await getRiskEvaluations({
    ...filters,
    page,
    pageSize,
  });

  res.json({
    evaluations: result.evaluations,
    count: result.evaluations.length,
    total: result.total,
    page,
    pageSize,
    totalPages: Math.ceil(result.total / pageSize),
  });
}

export async function getRiskEvaluationSummaryController(req, res) {
  const filters = readEvaluationFilters(req.query);
  const summary = await getRiskEvaluationSummary(filters);

  res.json(summary);
}

export async function compareRiskEvaluationsController(req, res) {
  const riskLibraryId = req.params.riskLibraryId?.trim();

  if (!riskLibraryId) {
    throw new HttpError(400, "Debes indicar el identificador del riesgo.");
  }

  const evaluations = await getEvaluationsForRisk(riskLibraryId);

  if (evaluations.length === 0) {
    throw new HttpError(
      404,
      "No existen evaluaciones para el riesgo seleccionado."
    );
  }

  res.json({
    riskLibraryId,
    evaluations,
    canCompare: evaluations.length >= 2,
  });
}


export async function getRiskEvaluationsByRiskIdController(req, res) {
  const { riskLibraryId } = req.params;
  const rawLimit = req.query.limit ?? '100';
  const limit = Number(rawLimit);

  if (!riskLibraryId || riskLibraryId.length > 30) {
    throw new HttpError(400, 'El identificador del riesgo no es válido.');
  }

  if (
    typeof rawLimit !== 'string' ||
    !/^[1-9]\d*$/.test(rawLimit) ||
    !Number.isSafeInteger(limit) ||
    limit > 100
  ) {
    throw new HttpError(
      400,
      'El parámetro limit debe ser un entero entre 1 y 100.'
    );
  }

  const evaluations = await getRiskEvaluationsByRiskId(
    riskLibraryId,
    limit
  );

  res.json({
    evaluations,
    count: evaluations.length,
  });
}




