import { Router } from "express";
import {
  getDesignerLayout,
  getDesignerLayouts,
  postDesignerLayout,
  putDesignerCanvas,
  putDesignerWorkflow,
} from "../controllers/designer.controller.js";
import { sameOrigin } from "../middlewares/auth.js";

const router = Router();

router.get("/layouts", getDesignerLayouts);
router.get("/layouts/:layoutId", getDesignerLayout);
router.post("/layouts", postDesignerLayout);
router.put("/layouts/:layoutId/canvas", putDesignerCanvas);
router.put("/layouts/:layoutId/workflow", sameOrigin, putDesignerWorkflow);

export default router;
