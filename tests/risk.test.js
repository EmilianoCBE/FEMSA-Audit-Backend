import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyRisk } from "../models/risk.model.js";

test("US07 calcula el puntaje como probabilidad × impacto", () => {
  assert.deepEqual(classifyRisk(3, 4), { probability: 3, impact: 4, score: 12, level: "Alto" });
});

test("US07 asigna el nivel en los límites de cada rango", () => {
  const casos = [
    [1, 1, "Bajo"],
    [2, 2, "Bajo"],
    [1, 5, "Medio"],
    [3, 3, "Medio"],
    [2, 5, "Alto"],
    [4, 4, "Alto"],
    [4, 5, "Crítico"],
    [5, 5, "Crítico"],
  ];

  for (const [probabilidad, impacto, nivel] of casos) {
    assert.equal(classifyRisk(probabilidad, impacto).level, nivel, `${probabilidad} × ${impacto}`);
  }
});
