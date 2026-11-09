import { requireAuth } from "./auth.js";
import { findRolePermissions } from "../models/permissions.model.js";
import { allows, isAdmin } from "../utils/permissions.js";
import { HttpError } from "../utils/httpErrors.js";

export function requireModule(moduleId, { readOnly = false } = {}) {
  return [
    (req, res, next) => {
      res.set("Cache-Control", "no-store");
      next();
    },
    requireAuth,
    async (req, res, next) => {
      if (isAdmin(req.user)) return next();
      const permissions = await findRolePermissions(req.user.roleId);
      if (!allows(permissions[moduleId], readOnly ? "GET" : req.method)) {
        throw new HttpError(403, "Tu rol no tiene permisos para esta operación en el módulo.");
      }
      next();
    },
  ];
}
