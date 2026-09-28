/** Error con código HTTP; el middleware errorHandler lo convierte en la respuesta. */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const badRequest = (message) => new HttpError(400, message);
export const notFoundError = (message = "Recurso no encontrado") => new HttpError(404, message);
