import { Router } from 'express';

import {
  getUsers,
  getRoles,
  assignUserRole
} from '../controllers/users.controller.js';

import {
  requireAuth,
  sameOrigin
} from '../middlewares/auth.js';

const router = Router();

router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

/**
 * US02.1
 * Lista de usuarios.
 */
router.get(
  '/',
  requireAuth,
  getUsers
);

/**
 * US02.2
 * Obtiene los roles disponibles.
 */
router.get(
  '/roles',
  requireAuth,
  getRoles
);

/**
 * US02.2
 * Asigna un rol a un usuario.
 */
router.put(
  '/:id/role',
  requireAuth,
  sameOrigin,
  assignUserRole
);

export default router;