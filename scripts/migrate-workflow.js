import { readFile } from "node:fs/promises";
import { closeDB, getPool } from "../db/db.js";

// Fase 4 del workflow: procesos en operación (AppWorkflowInstances y AppWorkflowHistory).
try {
  const migration = await readFile(new URL("../db/migrations/007-workflow-instances.sql", import.meta.url), "utf8");
  const pool = await getPool();
  await pool.request().batch(migration);
  console.log("Tablas de procesos del workflow listas.");
} catch (error) {
  console.error("No se pudieron crear las tablas de procesos del workflow:", error.message);
  process.exitCode = 1;
} finally {
  await closeDB();
}
