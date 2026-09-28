import { getPool } from "../db/db.js";

export const ping = (req, res) => {
  res.json({ msg: "pong" });
};

/** Verifica que la API y la base de datos respondan. */
export const health = async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request().query("SELECT 1 AS ok");
    res.json({ status: "ok", database: "ok" });
  } catch (error) {
    console.error("La base de datos no responde:", error.message);
    res.status(503).json({ status: "degraded", database: "unavailable" });
  }
};
