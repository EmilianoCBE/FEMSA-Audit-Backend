import { Router } from "express";
import {
  getVersionDetail,
  getVersions,
  postDiscardVersion,
  postPublishVersion,
  postRestoreVersion,
  postVersion,
} from "../controllers/versions.controller.js";
import { requireAuth, requireRoleName, sameOrigin } from "../middlewares/auth.js";
import { VERSION_EDITOR_ROLES } from "../services/versions.service.js";

const router = Router();
const canEdit = requireRoleName(...VERSION_EDITOR_ROLES);

router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

/** US11 - Historial de versiones de una aplicación. Consultar: cualquier sesión; modificar: VERSION_EDITOR_ROLES. */
router.get("/:appId/versions", requireAuth, getVersions);
router.get("/:appId/versions/:versionId", requireAuth, getVersionDetail);
router.post("/:appId/versions", requireAuth, sameOrigin, canEdit, postVersion);
router.post("/:appId/versions/:versionId/publish", requireAuth, sameOrigin, canEdit, postPublishVersion);
router.post("/:appId/versions/:versionId/discard", requireAuth, sameOrigin, canEdit, postDiscardVersion);
router.post("/:appId/versions/:versionId/restore", requireAuth, sameOrigin, canEdit, postRestoreVersion);

export default router;
