import { readFile } from 'node:fs/promises';
import { getPool, closeDB } from '../db/db.js';

try {
  const migration = await readFile(new URL('../db/migrations/001-auth.sql', import.meta.url), 'utf8');
  const pool = await getPool();
  await pool.request().batch(migration);
  console.log('Esquema de autenticación creado.');
} catch (error) {
  console.error('No se pudo crear el esquema:', error.message);
  process.exitCode = 1;
} finally { await closeDB(); }
