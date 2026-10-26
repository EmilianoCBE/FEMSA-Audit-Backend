import { Router } from "express";

import { getRiskLibraryController, getRiskLibraryByIdController } from "../controllers/riskLibrary.controller.js";

import { requireAuth } from "../middlewares/auth.js";

const router = Router();

router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

router.get("/", requireAuth, getRiskLibraryController);

router.get("/:id", requireAuth, getRiskLibraryByIdController);

export default router;
