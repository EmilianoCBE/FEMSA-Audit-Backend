import cors from "cors";
import express from "express";
import morgan from "morgan";
import { errorHandler, notFound } from "./middlewares/errorHandler.js";
import indexRoutes from "./routes/index.routes.js";

const app = express();

app.use(morgan("dev"));
// En desarrollo Vite reenvía /api, así que CORS solo importa cuando web y API están en dominios distintos.
app.use(cors({ origin: process.env.CORS_ORIGIN || true }));
app.use(express.json());

app.use("/api", indexRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
