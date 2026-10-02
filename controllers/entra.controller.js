import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify, createRemoteJWKSet } from 'jose';
import { findUserByEntraId, deleteSession } from '../models/auth.model.js';
import { cookieOptions, createSession, readCookie, SESSION_COOKIE, tokenHash } from '../utils/session.js';
import { HttpError } from '../utils/httpErrors.js';

const transactionCookie = 'femsa_entra';
const keys = new Map();
function configuration() {
  const tenant = process.env.ENTRA_TENANT_ID;
  const clientId = process.env.ENTRA_CLIENT_ID;
  const secret = process.env.ENTRA_CLIENT_SECRET;
  const redirect = process.env.ENTRA_REDIRECT_URI;
  const signingSecret = process.env.AUTH_SECRET;
  if (!tenant || !/^[a-f0-9-]{36}$/i.test(tenant) || !clientId || !secret || !redirect || !signingSecret || signingSecret.length < 32) {
    throw new HttpError(503, 'El acceso con Entra ID aún no está configurado. Contacta al administrador.');
  }
  return { tenant, clientId, secret, redirect, signingKey: new TextEncoder().encode(signingSecret),
    authority: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0` };
}
export async function entraStart(req, res) {
  const config = configuration();
  const state = randomBytes(32).toString('base64url');
  const nonce = randomBytes(32).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const transaction = await new SignJWT({ state, nonce, verifier }).setProtectedHeader({ alg: 'HS256' })
    .setIssuer('femsa-auth').setAudience('entra-callback').setIssuedAt().setExpirationTime('10m').sign(config.signingKey);
  res.cookie(transactionCookie, transaction, { ...cookieOptions(), maxAge: 600000 });
  const url = new URL(`${config.authority}/authorize`);
  url.search = new URLSearchParams({ client_id: config.clientId, response_type: 'code', redirect_uri: config.redirect,
    response_mode: 'query', scope: 'openid profile email', state, nonce,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString();
  res.redirect(url.toString());
}
export async function entraCallback(req, res) {
  res.clearCookie(transactionCookie, cookieOptions());
  const web = new URL('/login', process.env.WEB_ORIGIN || 'http://127.0.0.1:5173');
  try {
    const config = configuration();
    const cookie = readCookie(req, transactionCookie);
    if (!cookie) throw new Error('Missing transaction');
    const { payload } = await jwtVerify(cookie, config.signingKey, { algorithms: ['HS256'], issuer: 'femsa-auth', audience: 'entra-callback' });
    if (typeof req.query.state !== 'string' || req.query.state !== payload.state || typeof req.query.code !== 'string' || req.query.error) throw new Error('Invalid callback');
    const response = await fetch(`${config.authority}/token`, { method: 'POST', signal: AbortSignal.timeout(15000),
      body: new URLSearchParams({ client_id: config.clientId, client_secret: config.secret, grant_type: 'authorization_code',
        code: req.query.code, redirect_uri: config.redirect, code_verifier: payload.verifier }) });
    if (!response.ok) throw new Error('Token exchange failed');
    const tokens = await response.json();
    if (!keys.has(config.tenant)) keys.set(config.tenant, createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${config.tenant}/discovery/v2.0/keys`)));
    const { payload: claims } = await jwtVerify(tokens.id_token, keys.get(config.tenant), {
      algorithms: ['RS256'], audience: config.clientId, issuer: `https://login.microsoftonline.com/${config.tenant}/v2.0`,
      requiredClaims: ['exp', 'iat', 'sub', 'nonce', 'oid', 'tid'] });
    if (claims.nonce !== payload.nonce || claims.tid !== config.tenant || typeof claims.oid !== 'string' || !/^[a-f0-9-]{36}$/i.test(claims.oid)) throw new Error('Invalid identity');
    const user = await findUserByEntraId(claims.oid);
    if (!user) { web.searchParams.set('error', 'unauthorized'); return res.redirect(web.toString()); }
    const previous = readCookie(req, SESSION_COOKIE);
    if (previous) await deleteSession(tokenHash(previous));
    await createSession(res, user);
    res.redirect(new URL('/', web).toString());
  } catch {
    web.searchParams.set('error', 'entra');
    res.redirect(web.toString());
  }
}
