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
| GET | `/api/users` | US02 Karla: lista de usuarios con su rol (solo Administrador) |
| GET | `/api/users/roles` | US02 Karla: catálogo de roles (solo Administrador) |
| POST | `/api/users` | US02 Karla: alta de usuario `{ firstName, lastName, role_id, password }`; genera `nombre.apellido@femsa.com` (con sufijo si existe) (solo Administrador) |
| PUT | `/api/users/:id/role` | US02 Karla: cambia el rol `{ role_id }`; protege al último administrador activo (solo Administrador) |
| POST | `/api/risks/classify` | US07 Karla: `{ probability, impact }` (1–5) → puntaje y nivel (Bajo 1–4, Medio 5–9, Alto 10–16, Crítico 17–25) |
| GET | `/api/risk-library` | US07 Karla: biblioteca de riesgos; filtros `search` y `department` |
| GET | `/api/risk-library/:id` | US07 Karla: un riesgo de la biblioteca |
| GET | `/api/risk-evaluations` | US07 Karla: historial paginado; filtros `search`, `department`, `level`, `fromDate`, `toDate`, `page`, `pageSize` |
| POST | `/api/risk-evaluations` | US07 Karla: guarda `{ riskLibraryId, probability, impact }`; el servidor calcula puntaje y nivel y usa el usuario de la sesión |
| GET | `/api/risk-evaluations/summary` | US07 Karla: indicadores y datos de las gráficas (mismos filtros, sin paginación) |
| GET | `/api/risk-evaluations/risk/:riskLibraryId` | US07 Karla: evaluaciones de un riesgo |
| GET | `/api/risk-evaluations/compare/:riskLibraryId` | US07 Karla: evaluaciones de un riesgo para comparar |
| GET | `/api/designer/layouts` | US03 Magda: lista layouts disponibles para abrir en el Designer |
| GET | `/api/designer/layouts/:layoutId` | US03 Magda: obtiene un layout con sus elementos del canvas |
| POST | `/api/designer/layouts` | US03 Magda: crea un layout/módulo visual configurable |
| PUT | `/api/designer/layouts/:layoutId/canvas` | US03 Magda: guarda posiciones y configuración después del drag & drop |
| GET | `/api/apps/:appId/versions` | US11 Rafael: historial de versiones de la aplicación (sin la configuración) |
| GET | `/api/apps/:appId/versions/:versionId` | US11 Rafael: detalle de una versión con su `config` completa |
| POST | `/api/apps/:appId/versions` | US11 Rafael: guarda `{ config, changes[] }` como nuevo borrador (`v1`, `v2`, …) |
| POST | `/api/apps/:appId/versions/:versionId/publish` | US11 Rafael: publica un borrador; la vigente anterior pasa a archivada |
| POST | `/api/apps/:appId/versions/:versionId/restore` | US11 Rafael: crea un borrador nuevo con la configuración de esa versión |
| POST | `/api/ai/designer/analyze` | US15–US17 Emiliano: recibe `{ appId }` y devuelve sugerencias explicadas (reglas + IA) para un formulario del Designer; no cambia nada |
| POST | `/api/ai/recommendations/:id/decision` | US17 Emiliano: registra `{ decision: "accepted" \| "rejected" \| "replaced", change? }`; una sola vez por sugerencia (409) |
| GET | `/api/ai/designer/metrics?appId=` | US17 Emiliano: aceptación por origen (reglas / IA) y latencia promedio de la IA |

Los errores responden `{ "msg": "..." }` con su código HTTP.

Las rutas `/api/users/*`, `/api/risks/*`, `/api/risk-library/*` y `/api/risk-evaluations/*` requieren sesión; las de
usuarios además el rol Administrador (`role_id` 2). Las tablas `RISK_LIBRARY` y `RISK_EVALUATION` ya existen en la BD
compartida, pero todavía no tienen migración en `db/migrations/` (pendiente).

Las rutas `/api/apps/*` requieren sesión. Antes de usarlas crea la tabla con `npm run versions:migrate`
(requiere haber corrido `npm run auth:migrate`). `appId` es el id de la plantilla del Designer.

El asistente de IA (`/api/ai/*`, requiere sesión) usa `AI_PROVIDER=mock` por defecto: responde sin llamar a ningún
servicio externo. Las reglas de inconsistencias siempre responden; si el proveedor falla o tarda más de `AI_TIMEOUT_MS`,
la respuesta trae `aiAvailable: false` y solo las reglas.
Las sugerencias y las decisiones se guardan en `dbo.AppAiRecommendations`: créala con `npm run ai:migrate` (requiere
`npm run auth:migrate`). Si la tabla no existe o la BD falla, el análisis responde igual con `recorded: false`.
Para usar Gemini: `AI_PROVIDER=gemini` y `GEMINI_API_KEY` en `.env`; verifica con `npm run ai:check`.

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
