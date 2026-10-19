# Cómo trabajamos

Estas reglas aplican igual en **FEMSA-Audit** (frontend) y **FEMSA-Audit-Backend** (API).

## Ramas

| Rama | Para qué | Quién escribe |
| --- | --- | --- |
| `main` | Lo que se entrega / demo estable. Futuro ambiente de **producción**. | Solo PRs desde `develop` (o `hotfix/*`) |
| `develop` | Integración del sprint. Futuro ambiente de **staging**. | Solo PRs desde ramas de trabajo |
| `feature/USxx-descripcion` | Una historia de usuario. Ej. `feature/US08-notificaciones-topbar` | Su responsable |
| `fix/descripcion` | Corregir un bug encontrado en `develop` | Cualquiera |
| `chore/descripcion` | Configuración, dependencias, CI, documentación | Cualquiera |
| `hotfix/descripcion` | Bug urgente en `main` | Con aviso al equipo |

Nadie hace push directo a `main` ni a `develop`: GitHub lo bloquea.

## Flujo de una historia de usuario

```bash
# 1. Empezar SIEMPRE desde develop actualizado
git checkout develop
git pull
git checkout -b feature/US08-notificaciones-topbar

# 2. Trabajar con commits pequeños y subirlos seguido
git add .
git commit -m "feat(US08): mostrar contador de notificaciones"
git push -u origin feature/US08-notificaciones-topbar     # el primero; después solo git push

# 3. Cada vez que se mergee algo a develop, traerlo a tu rama
git checkout develop && git pull
git checkout feature/US08-notificaciones-topbar
git merge develop            # si hay conflicto: arreglar, git add ., git commit
git push

# 4. Antes de abrir el PR: correr lo mismo que corre el CI (ver "Antes de abrir un PR")
```

5. Abrir un **Pull Request hacia `develop`** en GitHub, llenar la plantilla y asignar revisor.
6. Esperar CI en verde + 1 aprobación. Atender comentarios con nuevos commits en la misma rama.
7. Se mergea con **Squash and merge** (un commit por historia en `develop`) y se **borra la rama**.
8. Para la siguiente historia, volver al paso 1 con una rama nueva. No reutilizar una rama ya mergeada.

Usar `git merge develop`, **no** `git rebase`: las ramas ya están en GitHub y rebase obligaría a hacer `push --force`.

## Commits

Formato: `tipo(USxx): descripción en presente`. El `(USxx)` es opcional si no aplica a una historia.

| Tipo | Uso |
| --- | --- |
| `feat` | Funcionalidad nueva |
| `fix` | Corrección de bug |
| `test` | Agregar o corregir pruebas |
| `refactor` | Cambiar código sin cambiar comportamiento |
| `docs` | Documentación |
| `chore` | Configuración, dependencias, CI |

Ejemplos: `feat(US07): calcular nivel de riesgo`, `fix: mensaje de error en login`, `test(US02): casos de asignación de rol`.

## Antes de abrir un PR

Frontend:

```bash
npm run format      # da formato a todo (Biome)
npm run check       # lint + formato, igual que el CI
npm run typecheck
npm test            # pruebas unitarias (Vitest)
npm run build && npm run preview   # en otra terminal: npm run test:e2e (Cypress)
```

Backend:

```bash
npm run lint
npm test            # o npm run test:coverage
```

Las pruebas del backend **nunca** se conectan a Azure: simulan la base de datos.

Recomendado: instalar la extensión **Biome** en VS Code y activar "Format on Save" para que el formato nunca genere conflictos.

## Pull Requests

- Título: `USxx: descripción` (será el commit en `develop`).
- Un PR = una historia (o un fix). PRs chicos se revisan rápido; PRs gigantes se atoran.
- Debe incluir pruebas de lo que agrega (ver "Definición de terminado").
- El revisor revisa que funcione, que siga la arquitectura y que no rompa otras pantallas. Aprobar sin revisar no cuenta.
- Si GitHub dice *"This branch has conflicts"*, el autor hace el paso 3 del flujo (merge de `develop`) en su compu.

## Entregas (develop → main)

Al cerrar cada sprint o antes de una demo, el responsable abre un PR de `develop` hacia `main` titulado `Release sprint N`,
se revisa que todo funcione en conjunto y se mergea con **Create a merge commit** (no squash).

**Hotfix:** rama `hotfix/...` desde `main`, PR hacia `main` y después un PR de `main` hacia `develop` para no perder el arreglo.

## Definición de terminado

Una historia está terminada cuando:

- [ ] Cumple los criterios de aceptación de la historia.
- [ ] Tiene pruebas: unitarias para la lógica nueva (front `lib/` y servicios; back servicios y validaciones) y, si agrega o
      cambia una pantalla o flujo, una prueba E2E en Cypress.
- [ ] El CI está en verde (lint, tipos, pruebas, build).
- [ ] Fue revisada y aprobada por otra persona.
- [ ] Si agrega variables de entorno, están en `.env.example`; si agrega endpoints, están documentados en el README del backend.
- [ ] Está mergeada en `develop`.
