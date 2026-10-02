import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
const options = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt, 64, options);
  return `scrypt$${salt}$${key.toString('hex')}`;
}

// También calcula un hash para usuarios inexistentes, evitando respuestas rápidas que revelen cuentas.
export async function verifyPassword(password, stored) {
  const valid = typeof stored === 'string' && /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(stored);
  const [, salt, hex] = valid ? stored.split('$') : ['scrypt', '0'.repeat(32), '0'.repeat(128)];
  const key = await derive(password, salt, 64, options);
  return timingSafeEqual(key, Buffer.from(hex, 'hex')) && valid;
}
