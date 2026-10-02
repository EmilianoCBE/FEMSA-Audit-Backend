import "dotenv/config";
import app from "./app.js";
import { connectDB } from "./db/db.js";

const PORT = process.env.PORT || 3000;

try {
  await connectDB();
} catch (error) {
  // La API arranca igual; /api/health indica si la base de datos está disponible.
  console.error(`No se pudo conectar a la base de datos: ${error.message}`);
  console.error("Revisa DB_PASSWORD en .env y que tu IP esté permitida en el firewall de Azure.");
}

app.listen(PORT, () => console.log(`API escuchando en http://localhost:${PORT}`));
