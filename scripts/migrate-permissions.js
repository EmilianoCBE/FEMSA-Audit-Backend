import { readFile } from "node:fs/promises";
import { closeDB, getPool } from "../db/db.js";
try {
  const migration = await readFile(new URL("../db/migrations/004-role-permissions.sql", import.meta.url), "utf8");
  await (await getPool()).request().batch(migration);
  console.log("Permisos predeterminados por rol configurados.");
} catch (error) {
  console.error("No se pudo migrar permisos:", error.message);
  process.exitCode = 1;
} finally {
  await closeDB();
}
