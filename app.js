import cors from "cors";
import express from "express";
import morgan from "morgan";
import { errorHandler, notFound } from "./middlewares/errorHandler.js";
import indexRoutes from "./routes/index.routes.js";
import authRoutes from "./routes/auth.routes.js";
import usersRoutes from "./routes/users.routes.js";
import riskRoutes from "./routes/risk.routes.js";
import riskEvaluationRoutes from "./routes/riskEvaluation.routes.js";
import riskLibraryRoutes from "./routes/riskLibrary.routes.js";
import designerRoutes from "./routes/designer.routes.js";
import versionsRoutes from "./routes/versions.routes.js";

const app = express();

app.use(
  morgan("dev", {
    skip: req => req.path === "/api/auth/entra/callback",
  })
);

app.use(
  cors({
    origin:
      process.env.WEB_ORIGIN || "http://127.0.0.1:5173",
    credentials: true,
  })
);

// US11: las versiones guardan la configuración completa de la aplicación, por eso aceptan cuerpos más grandes.
app.use("/api/apps", express.json({ limit: "256kb" }));
app.use(express.json({ limit: "16kb" }));

app.use("/api/auth", authRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/risks", riskRoutes);
app.use("/api/risk-evaluations", riskEvaluationRoutes);
app.use("/api/risk-library", riskLibraryRoutes);
app.use('/api/designer', designerRoutes);
app.use("/api/apps", versionsRoutes);
app.use("/api", indexRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;