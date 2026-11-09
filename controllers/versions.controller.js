// US11 - Rafael Valdez: historial de versiones de una aplicación del App Builder.
import {
  discardVersion,
  getVersion,
  listVersions,
  publishVersion,
  restoreVersion,
  saveVersion,
} from "../services/versions.service.js";

export const getVersions = async (req, res) => res.json(await listVersions(req.params.appId, req.user));

export const getVersionDetail = async (req, res) =>
  res.json({ version: await getVersion(req.params.appId, req.params.versionId) });

export const postVersion = async (req, res) =>
  res.status(201).json({ version: await saveVersion(req.params.appId, req.body, req.user) });

export const postPublishVersion = async (req, res) =>
  res.json({ version: await publishVersion(req.params.appId, req.params.versionId, req.user) });

export const postDiscardVersion = async (req, res) =>
  res.json({ version: await discardVersion(req.params.appId, req.params.versionId, req.user) });

/** Responde `{ version, backup }`: `backup` es el borrador con el estado previo del Designer, si hizo falta. */
export const postRestoreVersion = async (req, res) =>
  res.status(201).json(await restoreVersion(req.params.appId, req.params.versionId, req.user));
