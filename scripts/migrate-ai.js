import { readFile } from "node:fs/promises";
import { closeDB, getPool } from "../db/db.js";

try {
  const migration = await readFile(new URL("../db/migrations/003-ai-recommendations.sql", import.meta.url), "utf8");
  const pool = await getPool();
  await pool.request().batch(migration);
  console.log("Tabla de recomendaciones de IA creada.");
} catch (error) {
  console.error("No se pudo crear la tabla de recomendaciones de IA:", error.message);
  process.exitCode = 1;
} finally {
  await closeDB();
}
