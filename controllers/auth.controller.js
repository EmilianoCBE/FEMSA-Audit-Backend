import { findUserByIdentifier, publicUser, deleteSession } from '../models/auth.model.js';
import { verifyPassword } from '../utils/password.js';
import { createSession, readCookie, SESSION_COOKIE, cookieOptions, tokenHash } from '../utils/session.js';
import { HttpError } from '../utils/httpErrors.js';

export async function login(req, res) {
  const { identifier, password } = req.body ?? {};
  if (typeof identifier !== 'string' || !identifier.trim() || identifier.trim().length > 254 ||
      typeof password !== 'string' || !password || password.length > 1024) {
    throw new HttpError(400, 'Introduce tu usuario o email y contraseña.');
  }
  const user = await findUserByIdentifier(identifier.trim());
  const valid = await verifyPassword(password, user?.PasswordHash);
  if (!valid || !user?.IsActive) throw new HttpError(401, 'Usuario o contraseña incorrectos.');
  const previous = readCookie(req, SESSION_COOKIE);
  if (previous) await deleteSession(tokenHash(previous));
  await createSession(res, user);
  res.json({ user: publicUser(user) });
}
export async function logout(req, res) {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) await deleteSession(tokenHash(token));
  res.clearCookie(SESSION_COOKIE, cookieOptions());
  res.json({ ok: true });
}
export function me(req, res) { res.json({ user: req.user }); }
