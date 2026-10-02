import "dotenv/config";
import sql from "mssql";

const config = {
  server: process.env.DB_SERVER,
  port: Number(process.env.DB_PORT || 1433),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,

  options: {
    encrypt: process.env.DB_ENCRYPT !== "false",
    trustServerCertificate:
      process.env.DB_TRUST_SERVER_CERTIFICATE === "true",
  },

  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

let poolPromise;

export function getPool() {
  if (!poolPromise) {
    const missing = [
      "DB_SERVER",
      "DB_NAME",
      "DB_USER",
      "DB_PASSWORD",
    ].filter((name) => !process.env[name]);

    if (missing.length > 0) {
      throw new Error(
        `Faltan variables en apps/api/.env: ${missing.join(", ")}`
      );
    }

    poolPromise = new sql.ConnectionPool(config)
      .connect()
      .catch((error) => {
        poolPromise = undefined;
        throw error;
      });
  }

  return poolPromise;
}

export async function connectDB() {
  await getPool();

  console.log(
    `Conectado a ${config.database} en ${config.server}:${config.port}`
  );
}

export async function closeDB() {
  if (poolPromise) {
    const pool = await poolPromise;
    await pool.close();
    poolPromise = undefined;
  }
}

export { sql };
