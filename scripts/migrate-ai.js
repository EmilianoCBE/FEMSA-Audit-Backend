import { readFile } from "node:fs/promises";
import { closeDB, getPool } from "../db/db.js";

// 003 crea la tabla de recomendaciones; 006 agrega el registro del asistente del workflow (fase 3).
const MIGRATIONS = ["003-ai-recommendations.sql", "006-workflow-recommendations.sql"];

try {
  const pool = await getPool();
  for (const file of MIGRATIONS) {
    const migration = await readFile(new URL(`../db/migrations/${file}`, import.meta.url), "utf8");
    await pool.request().batch(migration);
    console.log(`Migración ${file} aplicada.`);
  }
  console.log("Tabla de recomendaciones de IA lista (Designer y Workflow).");
} catch (error) {
  console.error("No se pudo preparar la tabla de recomendaciones de IA:", error.message);
  process.exitCode = 1;
} finally {
  await closeDB();
}
