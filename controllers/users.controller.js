import { findAllUsers, findAllRoles, updateUserRole, createUser } from "../models/users.model.js";

import { HttpError } from "../utils/httpErrors.js";

export async function getUsers(req, res) {
  const users = await findAllUsers();
  res.json({ users });
}

export async function getRoles(req, res) {
  const roles = await findAllRoles();
  res.json({ roles });
}

export async function assignUserRole(req, res) {
  const userId = Number(req.params.id);
  const { role_id } = req.body ?? {};
  const roleId = Number(role_id);

  if (!Number.isInteger(userId) || userId <= 0) {
    throw new HttpError(400, "El ID del usuario no es válido.");
  }

  if (!Number.isInteger(roleId) || roleId <= 0) {
    throw new HttpError(400, "El ID del rol no es válido.");
  }

  const user = await updateUserRole(userId, roleId);

  if (!user) {
    throw new HttpError(404, "El usuario o el rol no existe.");
  }

  res.json({
    message: "Rol asignado correctamente.",
    user,
  });
}

/**
 * Registra un usuario local.
 */
export async function postUser(req, res) {
  const { firstName, lastName, role_id, password } = req.body ?? {};

  if (typeof firstName !== "string" || typeof lastName !== "string" || !firstName.trim() || !lastName.trim()) {
    throw new HttpError(400, "Introduce el nombre y los apellidos del usuario.");
  }

  const first = firstName.trim();
  const last = lastName.trim();

  if (first.length > 100 || last.length > 100 || /[<>]/.test(first + last)) {
    throw new HttpError(400, "El nombre o apellido no es válido.");
  }

  const roleId = Number(role_id);

  if (!Number.isInteger(roleId) || roleId <= 0) {
    throw new HttpError(400, "Selecciona un rol válido.");
  }

  if (typeof password !== "string" || password.length < 9 || password.length > 1024) {
    throw new HttpError(400, "La contraseña temporal debe tener al menos 9 caracteres.");
  }

  const slug = (value) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");

  const firstPart = slug(first.split(/\s+/)[0]);
  const lastPart = slug(last.split(/\s+/)[0]);

  if (!firstPart || !lastPart) {
    throw new HttpError(400, "No fue posible generar el correo corporativo con esos datos.");
  }

  const email = `${firstPart}.${lastPart}@femsa.com`;

  if (email.length > 200) {
    throw new HttpError(400, "El correo generado es demasiado largo.");
  }

  const user = await createUser({
    firstName: first,
    lastName: last,
    email,
    roleId,
    password,
  });

  res.status(201).json({
    message: "Usuario creado correctamente.",
    user,
  });
}
