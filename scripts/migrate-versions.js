import { readFile } from "node:fs/promises";
import { closeDB, getPool } from "../db/db.js";

// En orden: la tabla (002) y después las columnas de auditoría y el estado 'discarded' (004).
const migrations = ["002-app-versions.sql", "004-app-versions-audit.sql"];

try {
  const pool = await getPool();
  for (const file of migrations) {
    const migration = await readFile(new URL(`../db/migrations/${file}`, import.meta.url), "utf8");
    await pool.request().batch(migration);
  }
  console.log("Tabla de versiones lista.");
} catch (error) {
  console.error("No se pudo migrar la tabla de versiones:", error.message);
  process.exitCode = 1;
} finally {
  await closeDB();
}
