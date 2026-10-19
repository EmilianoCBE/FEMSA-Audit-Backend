// El lienzo del Designer vive en memoria (models/designer.model.js) y se pierde al reiniciar el servidor,
// pero las versiones (US11) sí se guardan en Azure SQL. Al pedir un layout por primera vez en cada ejecución,
// su lienzo se carga desde la última versión guardada para que "Guardar versión" no guarde la plantilla por defecto.
import { markDesignerHydrated, needsDesignerHydration, saveDesignerCanvas } from "../models/designer.model.js";
import { versionsRepository } from "../repositories/versions.repository.js";

export async function hydrateDesignerLayout(layoutId) {
  if (!needsDesignerHydration(layoutId)) return;

  try {
    const [latest] = await versionsRepository.list(layoutId);
    const detail = latest ? await versionsRepository.findById(layoutId, latest.id) : null;
    const elements = detail?.config?.elements;
    if (Array.isArray(elements)) saveDesignerCanvas(layoutId, elements);
    else markDesignerHydrated(layoutId);
  } catch {
    // BD no disponible: se queda el lienzo actual y se vuelve a intentar en la siguiente petición.
  }
}
