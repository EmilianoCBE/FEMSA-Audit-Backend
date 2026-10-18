import { readFile } from "node:fs/promises";
import { closeDB, getPool } from "../db/db.js";

try {
  const migration = await readFile(new URL("../db/migrations/002-app-versions.sql", import.meta.url), "utf8");
  const pool = await getPool();
  await pool.request().batch(migration);
  console.log("Tabla de versiones creada.");
} catch (error) {
  console.error("No se pudo crear la tabla de versiones:", error.message);
  process.exitCode = 1;
} finally {
  await closeDB();
}
