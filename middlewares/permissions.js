import { findPermissionsByRoleId } from "../models/permissions.model.js";
import { HttpError } from "../utils/httpErrors.js";

/** Carga los permisos del rol del usuario autenticado. Usar después de requireAuth. */
export async function loadPermissions(req, res, next) {
  if (!req.user) throw new HttpError(401, "Inicia sesión para continuar.");
  const permissions = req.user.roleId ? await findPermissionsByRoleId(req.user.roleId) : [];
  req.user.permissions = permissions.map(permission => ({ name: permission.name, module: permission.module }));
  next();
}

/** Exige todos los permisos indicados. Usar después de loadPermissions. */
export function requirePermission(...names) {
  return (req, res, next) => {
    const granted = new Set(req.user?.permissions?.map(permission => permission.name));
    if (!names.every(name => granted.has(name))) {
      throw new HttpError(403, "No tienes permisos para realizar esta acción.");
    }
    next();
  };
}
