// US11 - Rafael Valdez: guardar, consultar, publicar, descartar y restaurar versiones de una aplicación.
import { findDesignerLayout, saveDesignerCanvas } from "../models/designer.model.js";
import { versionsRepository } from "../repositories/versions.repository.js";
import { badRequest, HttpError, notFoundError } from "../utils/httpErrors.js";
import { hydrateDesignerLayout } from "./designer.service.js";

const MAX_APP_ID_LENGTH = 100;
export const MAX_CHANGES = 20;
export const MAX_CHANGE_LENGTH = 300;

/** Roles que pueden guardar, publicar, descartar y restaurar versiones. Los demás solo consultan. */
export const VERSION_EDITOR_ROLES = ["Administrador", "Creador de aplicaciones"];

const conflict = (message) => new HttpError(409, message);
const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function toIsoOrNull(date) {
  return date ? new Date(date).toISOString() : null;
}

/** JSON con las llaves ordenadas: dos configuraciones iguales dan el mismo texto aunque cambie el orden de llaves. */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isPlainObject(value)) {
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export const sameJson = (a, b) => canonicalJson(a) === canonicalJson(b);

/** Lo que el lienzo del Designer guarda de cada campo (mismo formato que normalizeDesignerElements). */
function canvasElements(elements) {
  return (Array.isArray(elements) ? elements : []).map(({ id, type, x, y, width, height, config }) => ({
    id,
    type,
    x,
    y,
    width,
    height,
    config: config ?? {},
  }));
}

const sameCanvas = (a, b) => sameJson(canvasElements(a), canvasElements(b));

export function canEditVersions(user) {
  const role = String(user?.role ?? "").toLowerCase();
  return VERSION_EDITOR_ROLES.some((allowed) => allowed.toLowerCase() === role);
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
    publishedBy: version.publishedByName ?? null,
    discardedAt: toIsoOrNull(version.discardedAt),
    discardedBy: version.discardedByName ?? null,
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

/** La aplicación es la plantilla del Designer: si no existe, no hay historial que consultar ni guardar. */
async function findAppOrFail(appId) {
  const id = validateAppId(appId);
  await hydrateDesignerLayout(id);
  const layout = findDesignerLayout(id);
  if (!layout) throw notFoundError("Aplicación no encontrada.");
  return layout;
}

async function findVersionOrFail(appId, versionId) {
  const version = await versionsRepository.findById(appId, parseVersionId(versionId));
  if (!version) throw notFoundError("Versión no encontrada.");
  return version;
}

const userRef = (user) => ({ userId: user.id, userName: user.name });

/**
 * Historial de la aplicación y en qué estado está el lienzo del Designer respecto a él:
 * `designer.versionId` es la versión que coincide con el lienzo (la más reciente, si son iguales) y
 * `designer.hasUnversionedChanges` avisa que el lienzo tiene cambios que no están en ninguna versión.
 */
export async function listVersions(appId, user) {
  const layout = await findAppOrFail(appId);
  const [versions, latest] = await Promise.all([
    versionsRepository.list(layout.id),
    versionsRepository.findLatest(layout.id),
  ]);
  const matchesLatest = latest ? sameCanvas(layout.elements, latest.config?.elements) : false;

  return {
    versions: versions.map(toPublicVersion),
    designer: {
      versionId: matchesLatest ? String(latest.id) : null,
      hasUnversionedChanges: latest ? !matchesLatest : layout.elements.length > 0,
    },
    canEdit: canEditVersions(user),
  };
}

export async function getVersion(appId, versionId) {
  const layout = await findAppOrFail(appId);
  return toPublicVersion(await findVersionOrFail(layout.id, versionId));
}

/** Guarda la configuración como un nuevo borrador, salvo que sea idéntica a la versión más reciente. */
export async function saveVersion(appId, { config, changes } = {}, author) {
  const layout = await findAppOrFail(appId);
  const validConfig = validateConfig(config);
  const validChanges = validateChanges(changes);

  const latest = await versionsRepository.findLatest(layout.id);
  if (latest && sameJson(latest.config, validConfig)) {
    throw conflict(`No hay cambios desde v${latest.number}: esa configuración ya está guardada.`);
  }

  const version = await versionsRepository.create({
    appId: layout.id,
    config: validConfig,
    changes: validChanges,
    authorId: author.id,
    authorName: author.name,
  });
  return toPublicVersion(version);
}

/** Convierte un borrador en la versión vigente; la vigente anterior queda archivada. */
export async function publishVersion(appId, versionId, user) {
  const layout = await findAppOrFail(appId);
  const version = await findVersionOrFail(layout.id, versionId);
  if (version.status === "archived") {
    throw conflict(`v${version.number} está archivada. Restáurala para crear un borrador nuevo y publícalo.`);
  }
  if (version.status !== "draft") throw conflict("Solo se pueden publicar versiones en borrador.");

  const published = await versionsRepository.publish(layout.id, version.id, userRef(user));
  if (!published) {
    throw conflict(
      `v${version.number} ya no está en borrador (se publicó o descartó en otra sesión). Recarga el historial.`,
    );
  }
  return toPublicVersion(published);
}

/** Descarta un borrador: deja de aparecer en el historial, pero la fila y su número se conservan. */
export async function discardVersion(appId, versionId, user) {
  const layout = await findAppOrFail(appId);
  const version = await findVersionOrFail(layout.id, versionId);
  if (version.status !== "draft") throw conflict("Solo se pueden descartar versiones en borrador.");

  const discarded = await versionsRepository.discard(layout.id, version.id, userRef(user));
  if (!discarded) {
    throw conflict(
      `v${version.number} ya no está en borrador (se publicó o descartó en otra sesión). Recarga el historial.`,
    );
  }
  return toPublicVersion(discarded);
}

/**
 * Recupera una configuración anterior sin perder historial ni trabajo:
 * 1. Si el lienzo del Designer tiene cambios que no están en ninguna versión, primero los guarda como
 *    borrador (`backup`), para que restaurar nunca borre trabajo.
 * 2. Crea un borrador nuevo con la configuración de la versión elegida (la original no se modifica).
 * 3. Aplica esa configuración al lienzo del Designer.
 */
export async function restoreVersion(appId, versionId, author) {
  const layout = await findAppOrFail(appId);
  const source = await findVersionOrFail(layout.id, versionId);
  if (source.status === "discarded") throw conflict(`v${source.number} se descartó y no se puede restaurar.`);
  if (sameCanvas(layout.elements, source.config?.elements)) {
    throw conflict(`El Designer ya tiene la configuración de v${source.number}.`);
  }

  const authorRef = { authorId: author.id, authorName: author.name };
  const latest = await versionsRepository.findLatest(layout.id);
  const backup =
    latest && sameCanvas(layout.elements, latest.config?.elements)
      ? null
      : await versionsRepository.create({
          appId: layout.id,
          config: { ...latest?.config, elements: layout.elements },
          changes: [`Estado del Designer antes de restaurar v${source.number}`],
          ...authorRef,
        });

  const version = await versionsRepository.create({
    appId: layout.id,
    config: source.config,
    changes: [`Se restauró la configuración de la versión v${source.number}`],
    ...authorRef,
    restoredFromId: source.id,
  });
  if (Array.isArray(source.config?.elements)) saveDesignerCanvas(layout.id, source.config.elements);

  return { version: toPublicVersion(version), backup: backup ? toPublicVersion(backup) : null };
}
