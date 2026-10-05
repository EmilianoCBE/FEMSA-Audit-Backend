import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import sql from 'mssql';
import { jwtVerify } from 'jose';
import { createHash } from 'node:crypto';
import { hashPassword, verifyPassword } from '../utils/password.js';

// Adaptador en memoria: prueba HTTP sin tocar la base de datos real.
const sessions = new Map();
let user, server, base, originalConnect, businessUserActive = true;
before(async () => {
  Object.assign(process.env, { DB_SERVER: 'test', DB_NAME: 'test', DB_USER: 'test', DB_PASSWORD: 'test', WEB_ORIGIN: 'http://127.0.0.1:5173' });
  delete process.env.ENTRA_TENANT_ID;
  user = { Id: '00000000-0000-4000-8000-000000000001', Username: 'auditor', Email: 'auditor@example.com', Name: 'Ana Pérez', Role: 'Auditor', IsActive: true, PasswordHash: await hashPassword('UnaClaveSegura123!') };
  originalConnect = sql.ConnectionPool.prototype.connect;
  sql.ConnectionPool.prototype.connect = async function () {
    return { close: async () => {}, request() {
      const values = {};
      return { input(name, type, value) { values[name] = value; return this; }, async query(query) {
        if (query.includes('WHERE a.Email =') || query.includes('WHERE a.Username =')) return { recordset: [user.Username, user.Email].includes(values.identifier) ? [{ ...user, IsActive: user.IsActive && businessUserActive }] : [] };
        if (query.includes('INSERT INTO dbo.AuthSessions')) { sessions.set(values.hash, { expiresAt: values.expiresAt }); return { recordset: [] }; }
        if (query.includes('JOIN dbo.AuthSessions')) {
          const session = sessions.get(values.hash);
          return { recordset: session && session.expiresAt > new Date() && user.IsActive && businessUserActive ? [user] : [] };
        }
        if (query.includes('DELETE FROM dbo.AuthSessions')) { sessions.delete(values.hash); return { recordset: [] }; }
        throw new Error('Unexpected SQL');
      } };
    } };
  };
  const { default: app } = await import('../app.js');
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  base = `http://127.0.0.1:${server.address().port}/api/auth`;
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  sql.ConnectionPool.prototype.connect = originalConnect;
  const { closeDB } = await import('../db/db.js');
  await closeDB();
});
const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('hash con sal, contraseña incorrecta y hash malformado', async () => {
  assert.notEqual(await hashPassword('UnaClaveSegura123!'), user.PasswordHash);
  assert.equal(await verifyPassword('UnaClaveSegura123!', user.PasswordHash), true);
  assert.equal(await verifyPassword('incorrecta', user.PasswordHash), false);
  assert.equal(await verifyPassword('incorrecta', 'hash-invalido'), false);
});
test('validación y mensaje genérico para credenciales inválidas', async () => {
  assert.equal((await post('/login', { identifier: [], password: 'a' })).status, 400);
  const wrong = await post('/login', { identifier: 'auditor', password: 'incorrecta' });
  const missing = await post('/login', { identifier: 'desconocido', password: 'incorrecta' });
  assert.equal(wrong.status, 401);
  assert.equal(missing.status, 401);
  assert.deepEqual(await wrong.json(), await missing.json());
});
test('rechaza otro origen y acceso sin sesión', async () => {
  assert.equal((await post('/login', { identifier: 'auditor', password: 'UnaClaveSegura123!' }, { Origin: 'https://otro.example' })).status, 403);
  assert.equal((await fetch(base + '/me')).status, 401);
});
test('login por usuario y email, cookie HttpOnly, sesión y logout', async () => {
  for (const identifier of ['auditor', 'auditor@example.com']) {
    const response = await post('/login', { identifier, password: 'UnaClaveSegura123!' });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.user.name, 'Ana Pérez');
    assert.equal(body.user.initials, 'AP');
    assert.equal(body.user.PasswordHash, undefined);
    const cookie = response.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
    const headers = { Cookie: cookie.split(';')[0] };
    assert.equal((await fetch(base + '/me', { headers })).status, 200);
    assert.equal((await post('/logout', {}, headers)).status, 200);
    assert.equal((await fetch(base + '/me', { headers })).status, 401);
  }
});
test('cuentas inactivas y sesiones expiradas pierden acceso', async () => {
  const response = await post('/login', { identifier: 'auditor', password: 'UnaClaveSegura123!' });
  const headers = { Cookie: response.headers.get('set-cookie').split(';')[0] };
  user.IsActive = false;
  assert.equal((await fetch(base + '/me', { headers })).status, 401);
  assert.equal((await post('/login', { identifier: 'auditor', password: 'UnaClaveSegura123!' })).status, 401);
  user.IsActive = true;
  businessUserActive = false;
  assert.equal((await fetch(base + '/me', { headers })).status, 401);
  assert.equal((await post('/login', { identifier: 'auditor', password: 'UnaClaveSegura123!' })).status, 401);
  businessUserActive = true;
  for (const session of sessions.values()) session.expiresAt = new Date(0);
  assert.equal((await fetch(base + '/me', { headers })).status, 401);
});
test('Entra sin configuración y callback falso no crean sesión', async () => {
  assert.equal((await fetch(base + '/entra')).status, 503);
  const response = await fetch(base + '/entra/callback?code=falso&state=falso', { redirect: 'manual' });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'http://127.0.0.1:5173/login?error=entra');
  assert.doesNotMatch(response.headers.get('set-cookie'), /femsa_session=/);
});
test('redirección Entra usa PKCE, nonce y state firmado; rechaza state diferente', async () => {
  Object.assign(process.env, { ENTRA_TENANT_ID: '00000000-0000-4000-8000-000000000002', ENTRA_CLIENT_ID: 'test-client', ENTRA_CLIENT_SECRET: 'test-secret',
    ENTRA_REDIRECT_URI: 'http://127.0.0.1:5173/api/auth/entra/callback', AUTH_SECRET: 's'.repeat(64) });
  const response = await fetch(base + '/entra', { redirect: 'manual' });
  assert.equal(response.status, 302);
  const url = new URL(response.headers.get('location'));
  assert.equal(url.origin, 'https://login.microsoftonline.com');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('response_type'), 'code');
  const cookie = response.headers.get('set-cookie').split(';')[0];
  const { payload } = await jwtVerify(cookie.slice('femsa_entra='.length), new TextEncoder().encode(process.env.AUTH_SECRET));
  assert.equal(url.searchParams.get('state'), payload.state);
  assert.equal(url.searchParams.get('nonce'), payload.nonce);
  assert.equal(url.searchParams.get('code_challenge'), createHash('sha256').update(payload.verifier).digest('base64url'));
  const callback = await fetch(base + '/entra/callback?code=falso&state=incorrecto', { redirect: 'manual', headers: { Cookie: cookie } });
  assert.equal(callback.headers.get('location'), 'http://127.0.0.1:5173/login?error=entra');
  assert.doesNotMatch(callback.headers.get('set-cookie'), /femsa_session=/);
});
test('limita intentos repetidos por IP', async () => {
  let response;
  for (let attempt = 0; attempt < 21; attempt++) {
    response = await post('/login', {});
    if (response.status === 429) break;
    assert.equal(response.status, 400);
  }
  assert.equal(response.status, 429);
});
