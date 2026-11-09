const PROBABILITIES = ["Inminente", "Altamente probable", "Probable", "No probable", "Remota"];

const IMPACTS = ["Menor", "Bajo", "Moderado", "Alto", "Crítico"];

const CONTROL_RATINGS = ["Inicial", "Funcional", "Definido", "Gestionado", "Optimizado"];

// Filas: probabilidad. Columnas: impacto.
const INHERENT_RISK_MATRIX = [
  ["Bajo", "Moderado", "Alto", "Crítico", "Crítico"],
  ["Bajo", "Moderado", "Alto", "Alto", "Crítico"],
  ["Bajo", "Bajo", "Moderado", "Alto", "Alto"],
  ["Menor", "Bajo", "Bajo", "Moderado", "Moderado"],
  ["Menor", "Menor", "Bajo", "Bajo", "Bajo"],
];

// Filas: diseño. Columnas: efectividad.
const CONTROL_LEVEL_MATRIX = [
  ["Inicial", "Inicial", "Inicial", "Inicial", "Inicial"],
  ["Inicial", "Funcional", "Funcional", "Funcional", "Funcional"],
  ["Inicial", "Funcional", "Definido", "Definido", "Definido"],
  ["Inicial", "Funcional", "Definido", "Gestionado", "Gestionado"],
  ["Inicial", "Funcional", "Definido", "Gestionado", "Optimizado"],
];

// Filas: riesgo inherente. Columnas: nivel de control.
// El orden de las columnas va de mayor a menor nivel de control.
const VULNERABILITY_MATRIX = [
  ["Bajo", "Moderado", "Alto", "Crítico", "Crítico"],
  ["Bajo", "Moderado", "Moderado", "Alto", "Alto"],
  ["Bajo", "Bajo", "Moderado", "Moderado", "Moderado"],
  ["Menor", "Menor", "Bajo", "Bajo", "Bajo"],
  ["Menor", "Menor", "Menor", "Menor", "Menor"],
];

const VULNERABILITY_VALUES = {
  Menor: 1,
  Bajo: 2,
  Moderado: 3,
  Alto: 4,
  Crítico: 5,
};

const VALUE_TO_VULNERABILITY = {
  1: "Menor",
  2: "Bajo",
  3: "Moderado",
  4: "Alto",
  5: "Crítico",
};

function getMatrixPosition(value, allowedValues, fieldName) {
  const position = allowedValues.indexOf(value);

  if (position === -1) {
    throw new Error(`${fieldName} no es una categoría válida: ${value}`);
  }

  return position;
}

export function calculateInherentRisk(probability, impact) {
  const row = getMatrixPosition(probability, PROBABILITIES, "La probabilidad");

  const column = getMatrixPosition(impact, IMPACTS, "El impacto");

  return INHERENT_RISK_MATRIX[row][column];
}

export function calculateControlLevel(designRating, effectivenessRating) {
  const row = getMatrixPosition(designRating, CONTROL_RATINGS, "El diseño");

  const column = getMatrixPosition(effectivenessRating, CONTROL_RATINGS, "La efectividad");

  return CONTROL_LEVEL_MATRIX[row][column];
}

export function calculateVulnerability(inherentLevel, controlLevel) {
  const row = getMatrixPosition(inherentLevel, ["Crítico", "Alto", "Moderado", "Bajo", "Menor"], "El riesgo inherente");

  const column = getMatrixPosition(
    controlLevel,
    ["Optimizado", "Gestionado", "Definido", "Funcional", "Inicial"],
    "El nivel de control",
  );

  return VULNERABILITY_MATRIX[row][column];
}

// Calcula el riesgo residual a partir de la última evaluación
// disponible de cada control asociado al riesgo.
// Recibe categorías de vulnerabilidad, no evaluaciones históricas completas.
export function calculateResidualRisk(vulnerabilities) {
  if (!Array.isArray(vulnerabilities)) {
    throw new Error("Las vulnerabilidades deben proporcionarse como una lista.");
  }

  if (vulnerabilities.length === 0) {
    return null;
  }

  const values = vulnerabilities.map((level) => {
    if (!Object.hasOwn(VULNERABILITY_VALUES, level)) {
      throw new Error(`La vulnerabilidad no es válida: ${level}`);
    }

    return VULNERABILITY_VALUES[level];
  });

  values.sort((a, b) => a - b);

  const middle = Math.floor(values.length / 2);
  let median;

  if (values.length % 2 === 1) {
    median = values[middle];
  } else {
    // Regla FEMSA: si queda un decimal, se redondea hacia arriba.
    median = Math.ceil((values[middle - 1] + values[middle]) / 2);
  }

  return {
    value: median,
    level: VALUE_TO_VULNERABILITY[median],
    evaluatedControls: values.length,
  };
}
