import { findSession, publicUser } from '../models/auth.model.js';
import { readCookie, SESSION_COOKIE, tokenHash } from '../utils/session.js';
import { HttpError } from '../utils/httpErrors.js';

export async function requireAuth(req, res, next) {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new HttpError(401, 'Inicia sesión para continuar.');
  const user = await findSession(tokenHash(token));
  if (!user) throw new HttpError(401, 'Tu sesión expiró. Inicia sesión nuevamente.');
  req.user = publicUser(user);
  next();
}
export function sameOrigin(req, res, next) {
  const origin = req.headers.origin;
  const allowed = process.env.WEB_ORIGIN || 'http://127.0.0.1:5173';
  if (origin && origin !== new URL(allowed).origin) throw new HttpError(403, 'Origen no permitido.');
  if (req.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'Origen no permitido.');
  next();
}
