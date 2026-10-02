import { createHash, randomBytes } from 'node:crypto';
import { insertSession } from '../models/auth.model.js';

export const SESSION_COOKIE = 'femsa_session';
export const tokenHash = token => createHash('sha256').update(token).digest('hex');
export function readCookie(req, name) {
  return req.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`))?.slice(name.length + 1);
}
export const cookieOptions = () => ({ httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' });
export async function createSession(res, user) {
  const token = randomBytes(32).toString('hex');
  const maxAge = 8 * 60 * 60 * 1000;
  await insertSession(tokenHash(token), user.Id, new Date(Date.now() + maxAge));
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(), maxAge });
}
