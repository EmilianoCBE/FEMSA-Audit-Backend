# Asistente de diseño (US15–US17): evaluación y privacidad

El asistente del Designer combina reglas propias (US16, siempre disponibles) con propuestas de Gemini (US15). La IA solo
propone: nada se aplica sin que el usuario acepte (US17). Si Gemini falla o tarda más de `AI_TIMEOUT_MS`, la respuesta
trae `aiAvailable: false` y solo quedan las reglas (US18).

En el Workflow (`POST /api/ai/workflow/analyze`, prompt `workflow-v1`) la IA propone transiciones que faltan y roles
(RF-17/RF-18) con las mismas garantías: valida ids, roles permitidos y que no repita transiciones ni lo que ya dicen
las reglas. Desde la fase 3 del workflow, si llega el formulario (`appId`) las sugerencias de la IA se guardan en
`dbo.AppAiRecommendations` con `Scope = 'workflow'`, y las decisiones sobre las reglas del flujo (que corren en el
navegador) se registran ya decididas con `POST /api/ai/workflow/decisions`. Requiere la migración 006
(`npm run ai:migrate`); sin ella el asistente sigue funcionando con `recorded: false`.

**RF-17 (generar un flujo):** `POST /api/ai/workflow/generate` (prompt `workflow-generate-v1`) recibe una descripción
en texto libre y propone estados y transiciones. Se revisa que el flujo se pueda usar (un inicial, al menos un final,
todo alcanzable, nada atorado, roles permitidos); si no, se pide una vez más y si sigue mal regresa `workflow: null`.
No se guarda ni se aplica: el front lo muestra como vista previa y el usuario decide.

## Evaluación (`npm run ai:eval`)

`evals/designer.cases.js` tiene 12 formularios **sintéticos** de hallazgo. Cada uno indica qué elementos de un hallazgo
completo faltan (fecha de detección, área, criterio, causa, riesgo, recomendación, responsable y fecha compromiso) y
qué campos deberían cambiar de componente. El script corre cada caso contra Gemini, califica la respuesta con
`services/ai/eval.js` y guarda el detalle en `evals/results/` (no se sube a git).

```bash
npm run ai:eval
npm run ai:eval -- --case sin-fechas
```

Necesita `GEMINI_API_KEY` en `.env` y hace una llamada por caso, por eso es manual y no corre en el CI. Las pruebas
(`tests/ai.eval.test.js`) revisan la calificación y la coherencia de los casos con el proveedor simulado.

### Resultados del 2026-11-08 (`gemini-flash-lite-latest`, prompt `designer-v1`)

Se corrió dos veces, con 12 casos cada vez y ninguna falla.

| Métrica | Corrida 1 | Corrida 2 | Meta (PLAN-IA §7) |
| --- | --- | --- | --- |
| Respuestas con JSON válido | 100 % | 100 % | 100 % |
| Sugerencias con explicación | 100 % | 100 % | 100 % |
| Sugerencias descartadas por la validación | 0 % | 0 % | — |
| Elementos faltantes que propone agregar | 76 % | 68 % | definir tras la primera corrida |
| Componentes corregidos (reglas + IA) | — | 100 % | 100 % |
| Propuestas de algo que ya existía | 0 | 0 | 0 |
| Tiempo promedio / p95 | 1430 / 2129 ms | 1321 / 1649 ms | p95 < 10 000 ms |

En la corrida 1 los componentes solo contaban lo que proponía la IA; desde la 2 cuentan reglas + IA, que es lo que ve el
usuario. La regla de componentes ya corrige esos campos, y a la IA se le pide no repetir lo que señalan las reglas.

Lecturas:

- El prompt limita la respuesta a 5 sugerencias. Por eso, en el formulario mínimo (faltan 8 elementos) nunca puede
  llegar al 100 %.
- Con campos sin renombrar, la IA propone poco, porque esos campos ya los señalan las reglas. Ahí está el margen de
  mejora del prompt.
- Los resultados varían entre corridas aunque la temperatura sea baja (0.2). Conviene reportar el promedio de varias.

Si se cambia el prompt, se crea `designer.v2.js` con otra `PROMPT_VERSION`, se corre `npm run ai:eval` y se comparan
los resultados con la versión anterior antes de reemplazarla.

## Revisión de privacidad (RNF-13)

Revisado en el código el 2026-11-08.

### Qué sale hacia Gemini

Solo la **estructura del formulario o del flujo** y lo que ya detectaron las reglas (`buildDesignerPrompt` y
`buildWorkflowPrompt` en `services/ai/prompts/`, cubiertos por las pruebas "RNF-13" de `tests/ai.gemini.test.js` y
`tests/ai.workflow.test.js`).

| Se envía | No se envía |
| --- | --- |
| Designer, por campo: id, tipo, etiqueta, obligatorio, sección y fórmula | Hallazgos capturados, auditorías ni evidencias |
| Workflow: estados (id, nombre, tipo) y transiciones (id, origen, destino, nombre, rol) | Posiciones del diagrama ni quién creó el flujo |
| Por revisión de las reglas: título, id del campo y tipo de cambio | Nombre, correo ni rol de quien pide el análisis |
| RF-17: la descripción que escribe el usuario, **sin correos ni números largos** (se cambian por `[dato omitido]`) | El id del formulario (`appId`) ni datos de la sesión |

### Dónde vive cada cosa

- **Llave de Gemini:** solo en el backend (`.env` local y variables de Vercel). El navegador nunca la ve; el front
  llama a `/api/ai/...`.
- **Pruebas y CI:** usan el proveedor simulado (`AI_PROVIDER=mock`). Nunca llaman a Gemini.
- **Lo que se guarda:** en `dbo.AppAiRecommendations` (Azure SQL del proyecto): cada sugerencia, la decisión, quién
  la pidió y quién decidió (id de `AuthUsers`), latencia y versión del prompt. No sale de Azure.
- **Logs:** el servidor no escribe en los logs el contenido del formulario ni las respuestas de la IA. Solo deja un
  aviso si no pudo guardar en la BD.

### Riesgos y qué falta

0. **RF-17: la descripción es texto libre.** Es lo único escrito por una persona que llega a Gemini. Mitigaciones:
   el back quita correos y números de 7 o más dígitos (`redactDescription`, probado en `tests/ai.workflow-fase3.test.js`),
   el front avisa antes de enviar si detecta un correo o teléfono y pide no escribir nombres ni datos confidenciales.
   Un nombre propio no se puede detectar de forma confiable: queda como responsabilidad de quien escribe.

1. **Las etiquetas son texto libre.** Si alguien escribe datos reales en una etiqueta (por ejemplo, el nombre de un
   empleado), ese texto llega a Gemini. Mitigación por ahora: las etiquetas describen campos, no capturan
   hallazgos. Pendiente: avisarlo en la pantalla del Designer.
2. **Nivel gratuito de Gemini.** Google puede usar lo enviado para mejorar sus productos. Con datos sintéticos y
   solo estructura es aceptable para el proyecto escolar. Para producción con FEMSA habría que usar un servicio que no
   entrene con los datos, como Gemini de pago o Vertex AI, o Azure OpenAI dentro del tenant (PLAN-IA §6).
3. **Autorización del servicio.** El profesor permitió usar cualquier servicio de IA. Falta confirmar con FEMSA qué
   servicio aceptaría en producción.
