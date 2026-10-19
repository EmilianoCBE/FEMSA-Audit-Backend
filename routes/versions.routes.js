import { Router } from "express";
import {
  getVersionDetail,
  getVersions,
  postPublishVersion,
  postRestoreVersion,
  postVersion,
} from "../controllers/versions.controller.js";
import { requireAuth, sameOrigin } from "../middlewares/auth.js";

const router = Router();

router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

/** US11 - Historial de versiones de una aplicación. */
router.get("/:appId/versions", requireAuth, getVersions);
router.get("/:appId/versions/:versionId", requireAuth, getVersionDetail);
router.post("/:appId/versions", requireAuth, sameOrigin, postVersion);
router.post("/:appId/versions/:versionId/publish", requireAuth, sameOrigin, postPublishVersion);
router.post("/:appId/versions/:versionId/restore", requireAuth, sameOrigin, postRestoreVersion);

export default router;
