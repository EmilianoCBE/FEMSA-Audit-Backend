import { Router } from "express";
import { postAnalyzeDesigner } from "../controllers/ai.controller.js";
import { requireAuth, sameOrigin } from "../middlewares/auth.js";

const router = Router();

router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

/** US15-US17: analiza un formulario del Designer y devuelve propuestas; no cambia nada. */
router.post("/designer/analyze", requireAuth, sameOrigin, postAnalyzeDesigner);

export default router;
