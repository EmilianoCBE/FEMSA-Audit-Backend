import { Router } from "express";
import {
  getDesignerLayout,
  getDesignerLayouts,
  postDesignerLayout,
  putDesignerCanvas,
} from "../controllers/designer.controller.js";

const router = Router();

router.get("/layouts", getDesignerLayouts);
router.get("/layouts/:layoutId", getDesignerLayout);
router.post("/layouts", postDesignerLayout);
router.put("/layouts/:layoutId/canvas", putDesignerCanvas);

export default router;

