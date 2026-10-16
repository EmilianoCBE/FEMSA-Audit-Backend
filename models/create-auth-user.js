import { getPool, sql } from '../db/db.js';
import { hashPassword } from '../utils/password.js';

export async function createAuthUser({ username, email, name, role = 'Auditor', password }) {
  if (!username || username.includes('@') || username.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200 || !name || name.length > 150 || !role || role.length > 200 || password.length < 12 || password.length > 1024) {
    throw new Error('Datos inválidos. Revisa los campos y la longitud de la contraseña.');
  }
  const hash = await hashPassword(password);
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const result = await new sql.Request(transaction)
      .input('username', sql.NVarChar(100), username).input('email', sql.VarChar(200), email)
      .input('name', sql.NVarChar(150), name).input('role', sql.VarChar(200), role)
      .input('hash', sql.VarChar(200), hash)
      .query(`
        DECLARE @roleId int, @userId int;
        SELECT @roleId = role_id FROM dbo.[ROLE] WHERE name = @role;
        IF @roleId IS NULL THROW 50001, 'El rol solicitado no existe.', 1;
        IF EXISTS (SELECT 1 FROM dbo.AuthUsers WHERE Username = @username OR Email = @email)
          THROW 50002, 'Ya existe una cuenta con ese usuario o email.', 1;
        SELECT @userId = user_id FROM dbo.[USER] WITH (UPDLOCK, HOLDLOCK) WHERE email = @email;
        IF @userId IS NOT NULL AND EXISTS (SELECT 1 FROM dbo.AuthUsers WHERE UserId = @userId)
          THROW 50003, 'El usuario ya tiene una cuenta de autenticación.', 1;
        IF @userId IS NOT NULL AND EXISTS (SELECT 1 FROM dbo.[USER] WHERE user_id = @userId AND (is_active = 0 OR role_id <> @roleId))
          THROW 50004, 'El usuario existente está inactivo o tiene otro rol.', 1;
        IF @userId IS NULL
        BEGIN
          -- El esquema exige entra_id. Este UUID local no vincula una identidad Microsoft;
          -- el login Entra solo consulta AuthUsers.EntraObjectId, que permanece NULL.
          INSERT INTO dbo.[USER] (entra_id, email, full_name, role_id)
            VALUES (NEWID(), @email, @name, @roleId);
          SET @userId = CONVERT(int, SCOPE_IDENTITY());
        END;
        INSERT INTO dbo.AuthUsers (Username, Email, Name, UserId, PasswordHash)
          OUTPUT inserted.Id
          VALUES (@username, @email, @name, @userId, @hash);
      `);
    await transaction.commit();
    return result.recordset[0];
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
