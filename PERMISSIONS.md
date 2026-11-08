# US13 — Permisos predeterminados por rol

## Activación

Antes de desplegar esta API y el frontend, ejecutar en el backend con las variables de Azure SQL del entorno destino:

```sh
npm run permissions:migrate
```

La migración `005-role-permissions.sql` crea `dbo.RoleModulePermissions` y agrega los valores iniciales de los roles existentes. Es transaccional y reejecutable: no sobrescribe decisiones posteriores. No se ejecuta automáticamente al iniciar el servidor. Debe aplicarse antes de habilitar la nueva interfaz. Las pruebas usan una base simulada; no ejecutan SQL contra Azure.

## Configuración inicial propuesta

| Rol | App Builder | Riesgos | Reportes |
| --- | --- | --- | --- |
| Administrador (ID 2) | Edición | Edición | Edición |
| Auditor | Edición | Edición | Lectura |
| Visualizador | Lectura | Lectura | Lectura |
| Otros roles | Oculto | Oculto | Oculto |

El ID 2 identifica al administrador, siguiendo la convención existente de gestión de usuarios. Los roles desconocidos y las asignaciones ausentes se resuelven como ocultos. Roles creados después de la migración aparecen en la matriz y pueden configurarse allí. Los valores iniciales son una propuesta de implementación, no criterios de aceptación adicionales recibidos del equipo.

## Uso

Desde **Usuarios y roles → Configurar permisos predeterminados por rol**, o **Designer → Permisos**, el administrador puede recorrer los niveles Edición → Lectura → Oculto. Cada cambio se guarda en el servidor; la interfaz informa errores y vuelve a consultar los valores persistidos si se rechaza. La columna del administrador permanece bloqueada para evitar perder acceso a la administración.

- Edición: consultar y escribir en el módulo.
- Lectura: consultar sin guardar cambios. La clasificación de riesgo es un cálculo sin persistencia y permite lectura aunque use POST.
- Oculto: se oculta la navegación y se bloquea el acceso directo por URL y las operaciones del módulo en la API.

La configuración se comparte por rol, no se copia al crear usuarios. Crear usuarios con ese rol o cambiarles el rol aplica la configuración correspondiente. El backend consulta permisos en cada operación: una sesión abierta recibe la nueva autorización en su siguiente petición. El frontend actualiza permisos al cargar y recuperar el foco. No hay excepciones por usuario.

## API

- `GET /api/permissions/me`: permisos efectivos de la sesión y capacidad para administrarlos.
- `GET /api/permissions`: matriz con los roles reales, solo administrador.
- `PUT /api/permissions/:roleId/:moduleId`, cuerpo `{ "level": "read" }`: cambio por rol y módulo, solo administrador y mismo origen.

Módulos: `app-builder`, `risks`, `reports`. Niveles: `edit`, `read`, `hidden`.

La autorización de App Builder cubre `/designer`, `/apps` (versiones) y `/ai`; Riesgos cubre `/risks`, `/risk-library` y `/risk-evaluations`. La gestión de usuarios conserva su protección exclusiva para administrador. Reportes consume actualmente datos simulados del frontend y genera archivos en el navegador: su permiso controla la sección; cuando exista una API de reportes deberá usar `requireModule("reports")`. Los flujos y validaciones que siguen siendo prototipos no adquieren persistencia con esta historia. Los permisos por campo y las excepciones por usuario quedan fuera del alcance de esta implementación por módulo.

## Validación

`node --test tests/permissions.test.js` verifica administración exclusiva, validaciones, persistencia entre consultas, cambios de rol, revocaciones en sesiones abiertas y bloqueo de operaciones de escritura en lectura. La base se simula en memoria.

En el frontend, `cypress/e2e/permissions.cy.ts` cubre guardado y recarga, reversión ante fallo, bloqueo de edición del administrador, accesos ocultos y controles de lectura. No sustituye una comprobación de la migración en Azure SQL.
