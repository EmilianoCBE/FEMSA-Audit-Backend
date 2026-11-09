// Orígenes del front que pueden llamar a la API.
// WEB_ORIGIN acepta varios separados por coma (producción, staging, local) y WEB_ORIGIN_PATTERN una expresión
// regular para los previews de cada PR (ej. ^https://femsa-audit-[a-z0-9]+-emilianocbes-projects\.vercel\.app$).
const DEFAULT_ORIGIN = "http://127.0.0.1:5173";

export function allowedOrigins(env = process.env) {
  return (env.WEB_ORIGIN || DEFAULT_ORIGIN)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => new URL(value).origin);
}

/** Origen principal: a donde se regresa al usuario (ej. después del login con Entra ID). */
export const primaryOrigin = (env = process.env) => allowedOrigins(env)[0];

export function isAllowedOrigin(origin, env = process.env) {
  if (!origin) return false;
  if (allowedOrigins(env).includes(origin)) return true;
  const pattern = env.WEB_ORIGIN_PATTERN?.trim();
  return Boolean(pattern) && new RegExp(`^(?:${pattern.replace(/^\^|\$$/g, "")})$`).test(origin);
}
