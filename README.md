# FEMSA Auditoría Interna — API

API REST del App Builder de Auditoría Interna FEMSA. El frontend vive en
[FEMSA-Audit](https://github.com/EmilianoCBE/FEMSA-Audit).

| | |
| --- | --- |
| Stack | Node.js ≥ 22 + Express 5 (JavaScript, ES Modules) + `mssql` |
| Base de datos | Azure SQL Database (SQL Server) — `femsa-101.database.windows.net` / `plantacion` |

## Puesta en marcha

```bash
npm install
```

1. Crea `.env` (a partir de `.env.example`) con `DB_SERVER`, `DB_NAME`, `DB_USER` y `DB_PASSWORD` de tu instancia de Azure SQL.
   Agrega también las variables de `.env.auth.example`. **`.env` nunca se sube al repo** (está en `.gitignore`).
2. Permite tu IP en el firewall: Azure Portal → SQL Server `femsa-101` → *Redes* → *Agregar la dirección IPv4 del cliente*.
   Cada integrante debe agregar la suya (y actualizarla si cambia de red).

```bash
npm run dev            # API en :3000 (nodemon, se reinicia al guardar)
npm start              # sin nodemon
npm test               # pruebas (node --test)
npm run test:coverage  # pruebas con reporte de cobertura
npm run lint           # lint (Biome)
npm run format         # da formato (Biome)
```

Verifica la conexión en <http://127.0.0.1:3000/api/health> → `{"status":"ok","database":"ok"}`.
Si la API no logra conectarse, arranca igual y muestra en consola qué revisar.

En desarrollo el frontend (Vite, `:5173`) reenvía `/api` a `http://127.0.0.1:3000`, así que basta con levantar
ambos repos con `npm run dev`. Consulta [AUTH.md](AUTH.md) para crear el esquema y usuarios de autenticación
y habilitar Microsoft Entra ID.

## Pruebas

- Van en `tests/<modulo>.test.js` con el runner nativo de Node (`node:test` + `node:assert`).
- **Nunca** se conectan a Azure: las pruebas HTTP levantan `app.js` en un puerto aleatorio y simulan la BD
  (ver el adaptador en memoria de `tests/auth.test.js`). Las reglas de negocio puras se prueban directo (ver `tests/risk.test.js`).
- El CI (`.github/workflows/ci.yml`) corre lint y pruebas en cada PR a `develop` o `main`.
- Flujo de ramas, commits y PRs: [CONTRIBUTING.md](CONTRIBUTING.md).

## Arquitectura

```
React (navegador) ──/api──▶ Express (este repo) ──mssql──▶ Azure SQL
```

El navegador **nunca** se conecta a la base de datos: las credenciales solo viven en la API.

Misma estructura que la REST API vista en clase (Express + dotenv + cors + morgan + nodemon), con SQL Server en lugar de MongoDB:

```
index.js          → carga .env, conecta a la BD y levanta el servidor
app.js            → middlewares (morgan, cors, json) y rutas bajo /api
db/db.js          → configuración de Azure SQL y pool de conexiones compartido (getPool)
db/migrations/    → scripts SQL
routes/           → define endpoints
controllers/      → req/res
models/           → acceso a datos
middlewares/      → auth, 404 y manejo central de errores
utils/            → errores HTTP, contraseñas, sesiones
scripts/          → migraciones y alta de usuarios (npm run auth:*)
tests/            → pruebas con node --test
```

| Método | Ruta | Descripción |
| --- | --- | --- |
| GET | `/api/ping` | `{"msg":"pong"}` |
| GET | `/api/health` | Estado de la conexión a la base de datos (503 si no responde) |
| — | `/api/auth/*` | Login, sesión, logout y Microsoft Entra ID (ver [AUTH.md](AUTH.md)) |
| GET | `/api/designer/layouts` | US03 Magda: lista layouts disponibles para abrir en el Designer |
| GET | `/api/designer/layouts/:layoutId` | US03 Magda: obtiene un layout con sus elementos del canvas |
| POST | `/api/designer/layouts` | US03 Magda: crea un layout/módulo visual configurable |
| PUT | `/api/designer/layouts/:layoutId/canvas` | US03 Magda: guarda posiciones y configuración después del drag & drop |

Los errores responden `{ "msg": "..." }` con su código HTTP.

### Al agregar tablas y endpoints

> Hoy la carpeta `models/` mezcla consultas SQL y reglas de negocio, y las validaciones viven en los controladores.
> El código **nuevo** sigue la estructura de abajo; los módulos existentes se migran poco a poco, cuando se toquen.
> Beneficio: las pruebas simulan el repositorio (una función) en lugar de reconocer el texto del SQL, que se rompe
> cada vez que alguien cambia una consulta.

Sigue el flujo `routes → controllers → services → repositories`:

- `repositories/<modulo>.repository.js` — solo SQL. Usa `const pool = await getPool()` y **siempre** parámetros
  (`.input("id", sql.Int, id)`), nunca concatenes valores del usuario en el SQL.
- `services/<modulo>.service.js` — reglas de negocio y validación (lanza `badRequest()` / `notFoundError()`).
- `controllers/<modulo>.controller.js` — `export const getX = async (req, res) => res.json(await service())`.
  Express 5 manda los errores al `errorHandler`, no hace falta `try/catch`.
- `routes/<modulo>.routes.js` — y regístralo en `app.js` con `app.use("/api", ...)`.

## Pendiente

- Diseñar y crear las tablas en Azure SQL y exponer los endpoints que consumirá el frontend.
- ESLint + Prettier.
