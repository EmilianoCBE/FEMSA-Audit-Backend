// US15 - Emiliano Carrizales: corre el conjunto de evaluación contra Gemini y reporta las métricas de PLAN-IA §7.
// Uso: npm run ai:eval                      (todos los casos)
//      npm run ai:eval -- --case sin-fechas  (uno solo)
// Manual: cuesta llamadas y necesita GEMINI_API_KEY, por eso no corre en el CI. Solo se envían formularios sintéticos.
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { DESIGNER_CASES } from "../evals/designer.cases.js";
import { validateAiSuggestions } from "../services/ai/ai.service.js";
import { LATENCY_GOAL_MS, scoreCase, summarize } from "../services/ai/eval.js";
import { createGeminiProvider, DEFAULT_GEMINI_MODEL } from "../services/ai/providers/gemini.provider.js";
import { runDesignerRules } from "../services/ai/rules/designer.rules.js";

const { values } = parseArgs({
  options: {
    case: { type: "string" },
    // El nivel gratuito limita las peticiones por minuto: se espera entre casos.
    delay: { type: "string", default: "4500" },
  },
});

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.log("Falta GEMINI_API_KEY en .env (https://aistudio.google.com/apikey).");
  process.exit(1);
}
const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
const provider = createGeminiProvider({ apiKey, model });
const timeoutMs = Number(process.env.AI_TIMEOUT_MS) || 15_000;

const cases = values.case ? DESIGNER_CASES.filter((testCase) => testCase.id === values.case) : DESIGNER_CASES;
if (cases.length === 0) {
  console.log(`No existe el caso "${values.case}". Casos: ${DESIGNER_CASES.map((c) => c.id).join(", ")}`);
  process.exit(1);
}

const pct = (value) => (value === null ? "—" : `${Math.round(value * 100)} %`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

console.log(`Modelo: ${model} · prompt: ${provider.promptVersion} · casos: ${cases.length}\n`);

const results = [];
for (const [index, testCase] of cases.entries()) {
  if (index > 0) await sleep(Number(values.delay));
  const known = runDesignerRules(testCase.fields);
  const started = Date.now();
  let result;
  try {
    const raw = await provider.suggestDesigner(
      { fields: testCase.fields, known },
      { signal: AbortSignal.timeout(timeoutMs) },
    );
    const latencyMs = Date.now() - started;
    result = scoreCase(testCase, {
      raw,
      valid: validateAiSuggestions(raw, testCase.fields, known),
      rules: known,
      latencyMs,
    });
  } catch (error) {
    result = scoreCase(testCase, { error, latencyMs: Date.now() - started });
  }
  results.push(result);

  if (!result.ok) {
    console.log(`✗ ${testCase.id}: falló en ${result.latencyMs} ms — ${result.error}`);
    continue;
  }
  const missing = result.missingExpected ? ` · faltantes ${result.missingFound}/${result.missingExpected}` : "";
  const components = result.componentsExpected
    ? ` · componentes ${result.componentsFound}/${result.componentsExpected}`
    : "";
  const redundant = result.redundant.length ? ` · repetidas: ${result.redundant.join(", ")}` : "";
  const notFound = result.missingNotFound.length ? ` · no encontró: ${result.missingNotFound.join(", ")}` : "";
  console.log(
    `${result.latencyMs < LATENCY_GOAL_MS ? "✓" : "!"} ${testCase.id}: ${result.latencyMs} ms · ` +
      `${result.valid}/${result.returned} válidas${missing}${components}${notFound}${redundant}`,
  );
}

const summary = summarize(results);
console.log(`
Resumen (${summary.cases} casos, ${summary.failed} fallidos)
| Métrica | Resultado | Meta |
| --- | --- | --- |
| Respuestas con JSON válido | ${pct(summary.jsonValidRate)} | 100 % |
| Sugerencias con explicación | ${pct(summary.reasonRate)} | 100 % |
| Sugerencias descartadas por la validación | ${pct(summary.discardRate)} | — |
| Elementos faltantes que encontró | ${pct(summary.missingRecall)} | definir tras la 1.ª corrida |
| Componentes corregidos (reglas + IA) | ${pct(summary.componentRecall)} (IA: ${summary.componentsByAi}) | 100 % |
| Propuestas de algo que ya existía | ${summary.redundant} | 0 |
| Tiempo promedio / p95 / máximo | ${summary.latency.avgMs} / ${summary.latency.p95Ms} / ${summary.latency.maxMs} ms | p95 < ${LATENCY_GOAL_MS} ms |
| Casos bajo 10 s | ${pct(summary.latency.underGoalRate)} | 100 % |`);

await mkdir(new URL("../evals/results/", import.meta.url), { recursive: true });
const file = new URL(
  `../evals/results/${new Date().toISOString().slice(0, 19).replaceAll(":", "-")}-${provider.promptVersion}.json`,
  import.meta.url,
);
await writeFile(
  file,
  `${JSON.stringify({ model, promptVersion: provider.promptVersion, date: new Date(), summary, results }, null, 2)}\n`,
);
console.log(`\nDetalle guardado en ${file.pathname}`);
