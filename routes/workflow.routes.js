import { Router } from "express";
import {
  getInstanceById,
  getInstances,
  getInstancesSummary,
  postInstance,
  postTransition,
} from "../controllers/workflow.controller.js";
import { sameOrigin } from "../middlewares/auth.js";

// Fase 4 del workflow: procesos (hallazgos) que recorren el flujo de su formulario.
// Lo que cada usuario puede hacer lo decide su rol en el flujo (no el permiso de configurar el App Builder).
const router = Router();

/** Procesos de un formulario (?appId=, ?status=active|completed). */
router.get("/instances", getInstances);

/** Cuántos procesos siguen en curso con cada versión (para avisar al publicar una nueva). */
router.get("/instances/summary", getInstancesSummary);

/** Inicia un proceso con la versión publicada del formulario: `{ appId, title }`. */
router.post("/instances", sameOrigin, postInstance);

/** Detalle: estado actual, flujo de su versión, acciones posibles para el usuario e historial. */
router.get("/instances/:id", getInstanceById);

/** Ejecuta una transición: `{ transitionId, comment?, evidence?, actionPlan? }`. */
router.post("/instances/:id/transitions", sameOrigin, postTransition);

export default router;
