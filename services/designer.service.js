// El lienzo del Designer vive en memoria (models/designer.model.js) y se pierde al reiniciar el servidor,
// pero las versiones (US11) sí se guardan en Azure SQL. Al pedir un layout por primera vez en cada ejecución,
// su lienzo se carga desde la versión más reciente (sin contar borradores descartados) para que
// "Guardar versión" no guarde la plantilla por defecto. Se usa la más reciente y no la vigente porque es
// la que refleja lo último que se trabajó (al restaurar, el lienzo queda con el borrador restaurado).
import {
  markDesignerHydrated,
  needsDesignerHydration,
  saveDesignerCanvas,
  saveDesignerWorkflow,
} from "../models/designer.model.js";
import { versionsRepository } from "../repositories/versions.repository.js";

export async function hydrateDesignerLayout(layoutId) {
  if (!needsDesignerHydration(layoutId)) return;

  try {
    const latest = await versionsRepository.findLatest(layoutId);
    const elements = latest?.config?.elements;
    // El flujo del proceso viaja en la misma versión que los campos (AppVersions.config.workflow).
    if (latest?.config?.workflow) saveDesignerWorkflow(layoutId, latest.config.workflow);
    if (Array.isArray(elements)) saveDesignerCanvas(layoutId, elements);
    else markDesignerHydrated(layoutId);
  } catch {
    // BD no disponible: se queda el lienzo actual y se vuelve a intentar en la siguiente petición.
  }
}
