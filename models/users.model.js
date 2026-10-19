
import { getPool, sql } from '../db/db.js';
import { HttpError } from '../utils/httpErrors.js';
import { hashPassword } from '../utils/password.js';

/**
 * Obtiene todos los usuarios junto con su rol.
 */
export async function findAllUsers() {
  const pool = await getPool();

  const result = await pool.request().query(`
    SELECT
      u.user_id,
      u.entra_id,
      u.email,
      u.full_name,
      u.is_active,
      u.created_at,
      r.role_id,
      r.name AS role_name,
      r.description AS role_description
    FROM dbo.[USER] AS u
    INNER JOIN dbo.[ROLE] AS r
      ON u.role_id = r.role_id
    ORDER BY u.full_name ASC;
  `);

  return result.recordset;
}

/**
 * Obtiene los roles disponibles.
 */
export async function findAllRoles() {
  const pool = await getPool();

  const result = await pool.request().query(`
    SELECT role_id, name, description
    FROM dbo.[ROLE]
    ORDER BY name ASC;
  `);

  return result.recordset;
}

/**
 * Asigna un rol y protege al último administrador activo.
 */
export async function updateUserRole(userId, roleId) {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);

  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

  try {
    const adminResult = await new sql.Request(transaction).query(`
      SELECT COUNT(*) AS activeAdmins
      FROM dbo.[USER] WITH (TABLOCKX, HOLDLOCK)
      WHERE role_id = 2 AND is_active = 1;
    `);

    const activeAdmins = Number(
      adminResult.recordset[0].activeAdmins
    );

    const roleResult = await new sql.Request(transaction)
      .input('roleId', sql.Int, roleId)
      .query(`
        SELECT role_id
        FROM dbo.[ROLE]
        WHERE role_id = @roleId;
      `);

    if (!roleResult.recordset.length) {
      await transaction.rollback();
      return null;
    }

    const userResult = await new sql.Request(transaction)
      .input('userId', sql.Int, userId)
      .query(`
        SELECT user_id, role_id, is_active
        FROM dbo.[USER]
        WHERE user_id = @userId;
      `);

    if (!userResult.recordset.length) {
      await transaction.rollback();
      return null;
    }

    const currentUser = userResult.recordset[0];

    const isActive =
      currentUser.is_active === true ||
      currentUser.is_active === 1;

    if (
      isActive &&
      Number(currentUser.role_id) === 2 &&
      Number(roleId) !== 2 &&
      activeAdmins <= 1
    ) {
      throw new HttpError(
        409,
        'No puedes quitar el rol al último administrador activo.'
      );
    }

    const updateResult = await new sql.Request(transaction)
      .input('userId', sql.Int, userId)
      .input('roleId', sql.Int, roleId)
      .query(`
        UPDATE dbo.[USER]
        SET role_id = @roleId
        OUTPUT
          inserted.user_id,
          inserted.email,
          inserted.full_name,
          inserted.role_id
        WHERE user_id = @userId;
      `);

    await transaction.commit();

    return updateResult.recordset[0];
  } catch (error) {
    try {
      await transaction.rollback();
    } catch {
      // La transacción pudo haberse revertido previamente.
    }

    throw error;
  }
}

/**
 * Crea un usuario local en USER y AuthUsers.
 * Si el correo ya existe, intenta con un número al final.
 * La contraseña se guarda únicamente como hash.
 */
export async function createUser({
  firstName,
  lastName,
  email,
  roleId,
  password
}) {
  const pool = await getPool();
  const passwordHash = await hashPassword(password);
  const fullName = `${firstName} ${lastName}`.trim();

  const transaction = new sql.Transaction(pool);

  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

  try {
    // Verificar que el rol exista.
    const roleResult = await new sql.Request(transaction)
      .input('roleId', sql.Int, roleId)
      .query(`
        SELECT role_id
        FROM dbo.[ROLE] WITH (UPDLOCK, HOLDLOCK)
        WHERE role_id = @roleId;
      `);

    if (!roleResult.recordset.length) {
      throw new HttpError(
        400,
        'El rol seleccionado no existe.'
      );
    }

    // Encontrar un correo que no esté registrado en ninguna tabla.
    const atIndex = email.lastIndexOf('@');

    if (atIndex <= 0 || email.length > 200) {
      throw new HttpError(
        400,
        'El correo generado no tiene un formato válido o es demasiado largo.'
      );
    }

    const namePart = email.substring(0, atIndex);
    const domainPart = email.substring(atIndex);

    let finalEmail = email;
    let suffix = 2;

    while (true) {
      if (finalEmail.length > 200) {
        throw new HttpError(
          400,
          'No se pudo generar un correo que cumpla con la longitud permitida.'
        );
      }

      const duplicateResult = await new sql.Request(transaction)
        .input('email', sql.VarChar(200), finalEmail)
        .query(`
          SELECT
            CASE
              WHEN EXISTS (
                SELECT 1
                FROM dbo.[USER] WITH (UPDLOCK, HOLDLOCK)
                WHERE email = @email
              )
              OR EXISTS (
                SELECT 1
                FROM dbo.AuthUsers WITH (UPDLOCK, HOLDLOCK)
                WHERE Email = @email
                   OR Username = @email
              )
              THEN 1
              ELSE 0
            END AS emailExists;
        `);

      if (Number(duplicateResult.recordset[0].emailExists) === 0) {
        break;
      }

      finalEmail = `${namePart}${suffix}${domainPart}`;
      suffix++;
    }

    // entra_id requiere un UUID en el esquema actual.
    // Este UUID es provisional; no es una identidad real de Microsoft.
    const userResult = await new sql.Request(transaction)
      .input('email', sql.VarChar(200), finalEmail)
      .input('fullName', sql.VarChar(200), fullName)
      .input('roleId', sql.Int, roleId)
      .query(`
        INSERT INTO dbo.[USER]
          (entra_id, email, full_name, is_active, role_id)
        OUTPUT
          inserted.user_id,
          inserted.email,
          inserted.full_name,
          inserted.is_active,
          inserted.created_at,
          inserted.role_id
        VALUES
          (NEWID(), @email, @fullName, 1, @roleId);
      `);

    const user = userResult.recordset[0];

    // Registrar las credenciales locales vinculadas al usuario.
    await new sql.Request(transaction)
      .input('username', sql.NVarChar(200), finalEmail)
      .input('email', sql.NVarChar(508), finalEmail)
      .input('name', sql.NVarChar(300), fullName)
      .input('passwordHash', sql.VarChar(200), passwordHash)
      .input('userId', sql.Int, user.user_id)
      .query(`
        INSERT INTO dbo.AuthUsers
          (Username, Email, Name, PasswordHash, UserId, IsActive)
        VALUES
          (@username, @email, @name, @passwordHash, @userId, 1);
      `);

    await transaction.commit();

    return user;
  } catch (error) {
    try {
      await transaction.rollback();
    } catch {
      // La transacción pudo haberse revertido previamente.
    }

    if (error.number === 2601 || error.number === 2627) {
      throw new HttpError(
        409,
        'El correo entró en conflicto con otro registro. Intenta crear el usuario nuevamente.'
      );
    }

    throw error;
  }
}


