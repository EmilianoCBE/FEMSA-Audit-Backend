export const MODULES = [
  { id: "app-builder", label: "App Builder" },
  { id: "risks", label: "Riesgos" },
  { id: "reports", label: "Reportes" },
];
export const LEVELS = ["hidden", "read", "edit"];
// El administrador conserva acceso para evitar bloqueos de administración.
export const isAdmin = (user) => Number(user.roleId) === 2;
export function allows(level, method) {
  return level === "edit" || (level === "read" && ["GET", "HEAD", "OPTIONS"].includes(method));
}
