import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { closeDB } from '../db/db.js';
import { createAuthUser } from '../models/create-auth-user.js';

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
  await createAuthUser({ username, email, name, role, password });
  console.log('Usuario creado.');
} catch (error) {
  hidden = false;
  console.error('No se pudo crear el usuario:', error.message);
  process.exitCode = 1;
} finally { input.close(); await closeDB(); }
