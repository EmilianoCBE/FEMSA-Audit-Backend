-- US11 - Rafael Valdez: historial de versiones de las aplicaciones del App Builder.
-- Ejecutar con `npm run versions:migrate`. Requiere 001-auth.sql. Puede ejecutarse nuevamente.
IF OBJECT_ID('dbo.AuthUsers', 'U') IS NULL
  THROW 50002, 'Primero ejecuta npm run auth:migrate (se requiere dbo.AuthUsers).', 1;
IF OBJECT_ID('dbo.AppVersions', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.AppVersions (
    Id INT IDENTITY(1, 1) NOT NULL PRIMARY KEY,
    AppId NVARCHAR(100) NOT NULL,
    VersionNumber INT NOT NULL,
    Status VARCHAR(10) NOT NULL DEFAULT 'draft',
    -- Configuración completa de la aplicación al momento de guardar (JSON).
    Config NVARCHAR(MAX) NOT NULL,
    -- Arreglo JSON con la descripción de los cambios.
    Changes NVARCHAR(MAX) NOT NULL,
    AuthorId UNIQUEIDENTIFIER NULL REFERENCES dbo.AuthUsers(Id),
    AuthorName NVARCHAR(150) NOT NULL,
    RestoredFromId INT NULL REFERENCES dbo.AppVersions(Id),
    CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    PublishedAt DATETIME2 NULL,
    CONSTRAINT UQ_AppVersions_Number UNIQUE (AppId, VersionNumber),
    CONSTRAINT CK_AppVersions_Status CHECK (Status IN ('draft', 'current', 'archived')),
    CONSTRAINT CK_AppVersions_Config CHECK (ISJSON(Config) = 1),
    CONSTRAINT CK_AppVersions_Changes CHECK (ISJSON(Changes) = 1)
  );
  -- Solo una versión vigente por aplicación.
  CREATE UNIQUE INDEX UQ_AppVersions_Current ON dbo.AppVersions (AppId) WHERE Status = 'current';
END;
