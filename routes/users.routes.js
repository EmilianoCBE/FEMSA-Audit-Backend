
import { Router } from 'express';

import {
  getUsers,
  getRoles,
  assignUserRole,
  postUser
} from '../controllers/users.controller.js';

import {
  requireAuth,
  requireRole,
  sameOrigin
} from '../middlewares/auth.js';

const router = Router();

router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

router.get(
  '/',
  requireAuth,
  requireRole(2),
  getUsers
);

router.get(
  '/roles',
  requireAuth,
  requireRole(2),
  getRoles
);

router.post(
  '/',
  requireAuth,
  requireRole(2),
  sameOrigin,
  postUser
);

router.put(
  '/:id/role',
  requireAuth,
  requireRole(2),
  sameOrigin,
  assignUserRole
);

export default router;
