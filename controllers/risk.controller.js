import { classifyRisk } from '../models/risk.model.js';
import { HttpError } from '../utils/httpErrors.js';

/**
 * US07
 * Clasifica un riesgo a partir de probabilidad e impacto.
 *
 * US07.1 - El usuario puede ingresar probabilidad e impacto.
 * US07.2 - El sistema calcula el resultado.
 * US07.3 - El sistema asigna el nivel correspondiente.
 */
export async function classifyRiskController(req, res) {
  const { probability, impact } = req.body ?? {};

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

  const result = classifyRisk(
    numericProbability,
    numericImpact
  );

  res.json({
    result,
  });
}