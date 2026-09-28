import { HttpError } from "../utils/httpErrors.js";

export function notFound(req, res) {
  res.status(404).json({ msg: `Ruta no encontrada: ${req.method} ${req.originalUrl}` });
}

/**
 * Manejo central de errores: Express 5 manda aquí cualquier error de un controlador async,
 * así los controladores no necesitan try/catch. Los errores inesperados no exponen detalles de la BD.
 */
// eslint-disable-next-line no-unused-vars -- Express reconoce este middleware por sus 4 parámetros.
export function errorHandler(error, req, res, next) {
  if (error instanceof HttpError) {
    return res.status(error.status).json({ msg: error.message });
  }
  if (error?.type === "entity.parse.failed") {
    return res.status(400).json({ msg: "El cuerpo de la petición no es JSON válido" });
  }
  console.error(`${req.method} ${req.originalUrl}`, error);
  res.status(500).json({ msg: "Error interno del servidor" });
}
