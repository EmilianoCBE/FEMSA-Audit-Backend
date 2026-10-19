// US11 - Rafael Valdez: guardar, consultar, publicar y restaurar versiones de una aplicación.
import { versionsRepository } from "../repositories/versions.repository.js";
import { badRequest, HttpError, notFoundError } from "../utils/httpErrors.js";

const MAX_APP_ID_LENGTH = 100;
const MAX_CHANGES = 20;
const MAX_CHANGE_LENGTH = 300;

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function toIsoOrNull(date) {
  return date ? new Date(date).toISOString() : null;
}

/** Forma pública de una versión (la que consume el frontend). `config` solo viene en el detalle. */
function toPublicVersion(version) {
  return {
    id: String(version.id),
    version: `v${version.number}`,
    number: version.number,
    status: version.status,
    author: version.authorName,
    changes: version.changes,
    createdAt: toIsoOrNull(version.createdAt),
    publishedAt: toIsoOrNull(version.publishedAt),
    restoredFrom: version.restoredFromNumber ? `v${version.restoredFromNumber}` : null,
    ...(version.config !== undefined && { config: version.config }),
  };
}

export function validateAppId(appId) {
  const value = typeof appId === "string" ? appId.trim() : "";
  if (!value || value.length > MAX_APP_ID_LENGTH) {
    throw badRequest(`El identificador de la aplicación es requerido (máximo ${MAX_APP_ID_LENGTH} caracteres).`);
  }
  return value;
}

export function validateChanges(changes) {
  if (!Array.isArray(changes) || changes.length === 0) {
    throw badRequest("changes debe ser un arreglo con al menos un cambio.");
  }
  if (changes.length > MAX_CHANGES) throw badRequest(`Máximo ${MAX_CHANGES} cambios por versión.`);

  return changes.map((change) => {
    const value = typeof change === "string" ? change.trim() : "";
    if (!value || value.length > MAX_CHANGE_LENGTH) {
      throw badRequest(`Cada cambio debe ser texto de 1 a ${MAX_CHANGE_LENGTH} caracteres.`);
    }
    return value;
  });
}

export function validateConfig(config) {
  if (!isPlainObject(config)) throw badRequest("config debe ser un objeto con la configuración de la aplicación.");
  return config;
}

function parseVersionId(versionId) {
  const id = Number(versionId);
  if (!Number.isSafeInteger(id) || id <= 0) throw notFoundError("Versión no encontrada.");
  return id;
}

async function findVersionOrFail(appId, versionId) {
  const version = await versionsRepository.findById(validateAppId(appId), parseVersionId(versionId));
  if (!version) throw notFoundError("Versión no encontrada.");
  return version;
}

export async function listVersions(appId) {
  const versions = await versionsRepository.list(validateAppId(appId));
  return versions.map(toPublicVersion);
}

export async function getVersion(appId, versionId) {
  return toPublicVersion(await findVersionOrFail(appId, versionId));
}

/** Guarda la configuración actual como un nuevo borrador. */
export async function saveVersion(appId, { config, changes } = {}, author) {
  const version = await versionsRepository.create({
    appId: validateAppId(appId),
    config: validateConfig(config),
    changes: validateChanges(changes),
    authorId: author.id,
    authorName: author.name,
  });
  return toPublicVersion(version);
}

/** Convierte un borrador en la versión vigente; la vigente anterior queda archivada. */
export async function publishVersion(appId, versionId) {
  const version = await findVersionOrFail(appId, versionId);
  if (version.status !== "draft") throw new HttpError(409, "Solo se pueden publicar versiones en borrador.");

  return toPublicVersion(await versionsRepository.publish(version.appId, version.id));
}

/**
 * Recupera una configuración anterior sin perder historial: crea un borrador nuevo con la
 * configuración de la versión elegida. La versión original no se modifica.
 */
export async function restoreVersion(appId, versionId, author) {
  const source = await findVersionOrFail(appId, versionId);
  const version = await versionsRepository.create({
    appId: source.appId,
    config: source.config,
    changes: [`Se restauró la configuración de la versión v${source.number}`],
    authorId: author.id,
    authorName: author.name,
    restoredFromId: source.id,
  });
  return toPublicVersion(version);
}
