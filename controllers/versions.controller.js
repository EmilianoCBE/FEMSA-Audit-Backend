// US11 - Rafael Valdez: historial de versiones de una aplicación del App Builder.
import { getVersion, listVersions, publishVersion, restoreVersion, saveVersion } from "../services/versions.service.js";

export const getVersions = async (req, res) => res.json({ versions: await listVersions(req.params.appId) });

export const getVersionDetail = async (req, res) =>
  res.json({ version: await getVersion(req.params.appId, req.params.versionId) });

export const postVersion = async (req, res) =>
  res.status(201).json({ version: await saveVersion(req.params.appId, req.body, req.user) });

export const postPublishVersion = async (req, res) =>
  res.json({ version: await publishVersion(req.params.appId, req.params.versionId) });

export const postRestoreVersion = async (req, res) =>
  res.status(201).json({ version: await restoreVersion(req.params.appId, req.params.versionId, req.user) });
