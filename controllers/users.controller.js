import {
  findAllUsers,
  findAllRoles,
  updateUserRole
} from '../models/users.model.js';

import { HttpError } from '../utils/httpErrors.js';

/**
 * US02.1
 * Obtiene la lista de usuarios.
 */
export async function getUsers(req, res) {
  const users = await findAllUsers();

  res.json({
    users
  });
}

/**
 * US02.2
 * Obtiene la lista de roles disponibles.
 */
export async function getRoles(req, res) {
  const roles = await findAllRoles();

  res.json({
    roles
  });
}

/**
 * US02.2
 * Asigna un rol a un usuario.
 */
export async function assignUserRole(req, res) {
  const userId = Number(req.params.id);
  const { role_id } = req.body ?? {};

  if (!Number.isInteger(userId) || userId <= 0) {
    throw new HttpError(
      400,
      'El ID del usuario no es válido.'
    );
  }

  if (!Number.isInteger(Number(role_id)) || Number(role_id) <= 0) {
    throw new HttpError(
      400,
      'El ID del rol no es válido.'
    );
  }

  const user = await updateUserRole(
    userId,
    Number(role_id)
  );

  if (!user) {
    throw new HttpError(
      404,
      'El usuario o el rol no existe.'
    );
  }

  res.json({
    message: 'Rol asignado correctamente.',
    user
  });
}