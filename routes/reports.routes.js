import { Router } from "express";
import { requireAuth, sameOrigin } from "../middlewares/auth.js";
import { getReportController } from "../controllers/reports.controller.js";

const router = Router();
router.use(requireAuth, sameOrigin);
router.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
router.get("/", getReportController);
export default router;
