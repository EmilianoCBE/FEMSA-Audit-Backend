import cors from "cors";
import express from "express";
import morgan from "morgan";
import { errorHandler, notFound } from "./middlewares/errorHandler.js";
import indexRoutes from "./routes/index.routes.js";
import authRoutes from "./routes/auth.routes.js";

const app = express();

// El callback contiene un código de autorización: no enviarlo a logs.
app.use(morgan("dev", { skip: req => req.path === '/api/auth/entra/callback' }));
// En desarrollo Vite reenvía /api, así que CORS solo importa cuando web y API están en dominios distintos.
app.use(cors({ origin: process.env.WEB_ORIGIN || 'http://127.0.0.1:5173', credentials: true }));
app.use(express.json({ limit: '16kb' }));

app.use('/api/auth', authRoutes);
app.use("/api", indexRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
