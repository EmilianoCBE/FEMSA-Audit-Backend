// Fase 4 del workflow - Emiliano Carrizales: procesos en operación (solo HTTP; la lógica está en el servicio).
import {
  executeTransition,
  getInstance,
  instancesSummary,
  listInstances,
  startInstance,
} from "../services/workflowRuntime.service.js";

export const getInstances = async (req, res) =>
  res.json({ instances: await listInstances(req.query.appId, req.query.status) });

export const getInstancesSummary = async (req, res) => res.json(await instancesSummary(req.query.appId));

export const postInstance = async (req, res) =>
  res.status(201).json({ instance: await startInstance(req.body, req.user) });

export const getInstanceById = async (req, res) => res.json({ instance: await getInstance(req.params.id, req.user) });

export const postTransition = async (req, res) =>
  res.json({ instance: await executeTransition(req.params.id, req.body, req.user) });
