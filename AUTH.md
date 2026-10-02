# Login y sesiones

La página `/login` prioriza Entra ID y ofrece usuario/email y contraseña como alternativa. Ambos métodos crean una sesión de ocho horas en Azure SQL, con una cookie HttpOnly, SameSite=Lax y Secure en producción. La API guarda únicamente el SHA-256 del token de sesión y contraseñas con scrypt y sal aleatoria. No hay registro público de usuarios.

## Preparar acceso local

1. Configura `DB_SERVER`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` en `.env`.
2. Agrega las variables de `.env.auth.example` a ese mismo archivo. Para acceso local basta con `WEB_ORIGIN` y `NODE_ENV`.
3. Ejecuta `npm run auth:migrate`. Crea `dbo.AuthUsers` y `dbo.AuthSessions` sin modificar tablas existentes; puede ejecutarse nuevamente.
4. Ejecuta `npm run auth:create-user` en una terminal. Solicita usuario, email, nombre, rol y contraseña oculta (mínimo 12 caracteres).
5. Ejecuta `npm run dev` aquí y también en el repo del frontend ([FEMSA-Audit](https://github.com/EmilianoCBE/FEMSA-Audit)); abre `http://127.0.0.1:5173/login`. Usa este mismo host en `WEB_ORIGIN`.

`Username` no admite `@`; así los identificadores de email y usuario no son ambiguos. `Role` se devuelve desde SQL y no lo decide el navegador. Si ya existe otra tabla de usuarios, adapta `models/auth.model.js` a sus columnas y migra los hashes al formato `scrypt$<sal hexadecimal>$<hash hexadecimal>`; no almacenes contraseñas sin hash.

## Configurar Microsoft Entra ID

Registra una aplicación de un solo tenant en Microsoft Entra ID. Configura una plataforma **Web** con el redirect `http://127.0.0.1:5173/api/auth/entra/callback` (Vite lo reenvía a Express). Agrega a `.env` el tenant ID, client ID, client secret y redirect URI. Genera `AUTH_SECRET` con `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.

El backend utiliza [Authorization Code con PKCE y OpenID Connect](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow), valida firma, issuer, audience, expiración, tenant y nonce, y comprueba `state` antes del intercambio. El secreto de Microsoft permanece en el backend.

Autoriza cada cuenta vinculando el **Object ID del usuario en el tenant** a `AuthUsers.EntraObjectId` (no el client ID de la aplicación). Para una cuenta existente:

```sql
UPDATE dbo.AuthUsers
SET EntraObjectId = '<object-id-del-usuario>'
WHERE Email = '<correo-corporativo>';
```

Para acceso exclusivo con Entra, crea una fila con Username, Email, Name y EntraObjectId, dejando PasswordHash en NULL. Una cuenta de Microsoft sin una fila activa autorizada no accede. No se vinculan cuentas automáticamente por email.

## Rutas

| Método | Ruta | Comportamiento |
|---|---|---|
| POST | `/api/auth/login` | JSON `{ "identifier": "usuario o email", "password": "contraseña" }` |
| GET | `/api/auth/entra` | Redirige a Microsoft |
| GET | `/api/auth/entra/callback` | Valida identidad y crea sesión |
| GET | `/api/auth/me` | Devuelve usuario autenticado o 401 |
| POST | `/api/auth/logout` | Revoca sesión y elimina cookie |

Las rutas del frontend requieren sesión. Para nuevas rutas de datos de la API, usa `requireAuth` de `middlewares/auth.js`; ping y health siguen públicos. Los permisos por rol de las funcionalidades existentes no están implementados por este login.

En producción configura `NODE_ENV=production`, HTTPS, `WEB_ORIGIN` y el redirect real; publica la web y `/api` bajo el mismo sitio. El limitador de intentos usa memoria por proceso (20 intentos cada 15 minutos por IP); para múltiples instancias se necesita un almacén compartido. Configura `trust proxy` según tu infraestructura antes de usar un proxy inverso.

## Verificación

`npm test` prueba hashes, validación, login por ambas clases de identificador, sesiones, logout, cuentas inactivas y retornos inválidos. Utiliza un adaptador SQL en memoria; no valida conectividad ni ejecuta la migración en Azure. Para comprobar Entra de extremo a extremo se requieren las credenciales y un usuario autorizado del tenant.
