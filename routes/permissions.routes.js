import { Router } from "express";
import { requireAuth, requireRole, sameOrigin } from "../middlewares/auth.js";
import { findPermissionMatrix, findRolePermissions, saveRolePermission } from "../models/permissions.model.js";
import { MODULES, LEVELS, isAdmin } from "../utils/permissions.js";
import { HttpError } from "../utils/httpErrors.js";
const router = Router();
router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
router.use(requireAuth);
router.get("/me", async (req, res) => {
  const permissions = isAdmin(req.user)
    ? Object.fromEntries(MODULES.map(({ id }) => [id, "edit"]))
    : await findRolePermissions(req.user.roleId);
  res.json({ permissions, canManagePermissions: isAdmin(req.user) });
});
router.get("/", requireRole(2), async (req, res) => res.json(await findPermissionMatrix()));
router.put("/:roleId/:moduleId", requireRole(2), sameOrigin, async (req, res) => {
  const roleId = Number(req.params.roleId);
  const { moduleId } = req.params;
  const { level } = req.body ?? {};
  if (
    !Number.isSafeInteger(roleId) ||
    roleId <= 0 ||
    roleId > 2147483647 ||
    !MODULES.some(({ id }) => id === moduleId) ||
    !LEVELS.includes(level)
  ) {
    throw new HttpError(400, "Rol, módulo o nivel de permiso inválido.");
  }
  if (roleId === 2) throw new HttpError(409, "Los permisos del administrador no se pueden reducir.");
  if (!(await saveRolePermission(roleId, moduleId, level))) throw new HttpError(404, "El rol no existe.");
  res.json({ roleId, moduleId, level });
});
export default router;
