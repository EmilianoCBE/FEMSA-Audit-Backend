
import { classifyRisk } from '../models/risk.model.js';
import { findRiskLibraryById } from '../models/riskLibrary.model.js';
import { createRiskEvaluation } from '../models/riskEvaluation.model.js';
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
