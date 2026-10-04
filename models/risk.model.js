
/**
 * US07 - Clasificación de riesgos
 *
 * Calcula el puntaje de riesgo a partir de probabilidad e impacto
 * y determina el nivel correspondiente.
 */

const RISK_LEVELS = [
  {
    min: 1,
    max: 4,
    level: 'Bajo',
  },
  {
    min: 5,
    max: 9,
    level: 'Medio',
  },
  {
    min: 10,
    max: 16,
    level: 'Alto',
  },
  {
    min: 17,
    max: 25,
    level: 'Crítico',
  },
];

/**
 * Clasifica un riesgo a partir de su probabilidad e impacto.
 *
 * US07.2 - El sistema calcula el resultado.
 * US07.3 - El sistema asigna el nivel correspondiente.
 */
export function classifyRisk(probability, impact) {
  const score = probability * impact;

  const classification = RISK_LEVELS.find(
    (range) => score >= range.min && score <= range.max
  );

  return {
    probability,
    impact,
    score,
    level: classification.level,
  };
}

