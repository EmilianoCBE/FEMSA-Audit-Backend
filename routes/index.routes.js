import { Router } from "express";
import { health, ping } from "../controllers/index.controller.js";

const router = Router();

router.get("/ping", ping);
router.get("/health", health);

export default router;
