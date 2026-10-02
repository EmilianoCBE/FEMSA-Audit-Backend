import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { getPool, closeDB, sql } from '../db/db.js';
import { hashPassword } from '../utils/password.js';

let hidden = false;
const output = new Writable({ write(chunk, encoding, callback) { if (!hidden) process.stdout.write(chunk, encoding); callback(); } });
const input = createInterface({ input: process.stdin, output, terminal: Boolean(process.stdin.isTTY) });
try {
  const username = (await input.question('Usuario (sin @): ')).trim();
  const email = (await input.question('Email: ')).trim();
  const name = (await input.question('Nombre: ')).trim();
  const role = (await input.question('Rol [Auditor]: ')).trim() || 'Auditor';
  process.stdout.write('Contraseña (mínimo 12 caracteres, oculta): ');
  hidden = true;
  const password = await input.question('');
  hidden = false;
  process.stdout.write('\n');
  if (!username || username.includes('@') || username.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !name || name.length > 150 || role.length > 80 || password.length < 12 || password.length > 1024) throw new Error('Datos inválidos. Revisa los campos y la longitud de la contraseña.');
  const hash = await hashPassword(password);
  const pool = await getPool();
  await pool.request().input('username', sql.NVarChar(100), username).input('email', sql.NVarChar(254), email)
    .input('name', sql.NVarChar(150), name).input('role', sql.NVarChar(80), role).input('hash', sql.VarChar(200), hash)
    .query('INSERT INTO dbo.AuthUsers (Username, Email, Name, Role, PasswordHash) VALUES (@username, @email, @name, @role, @hash)');
  console.log('Usuario creado.');
} catch (error) {
  hidden = false;
  console.error('No se pudo crear el usuario:', error.message);
  process.exitCode = 1;
} finally { input.close(); await closeDB(); }
