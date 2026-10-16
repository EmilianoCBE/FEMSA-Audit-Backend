-- Ejecutar una vez en Azure SQL. No modifica tablas existentes.
IF OBJECT_ID('dbo.USER', 'U') IS NULL OR OBJECT_ID('dbo.ROLE', 'U') IS NULL
  THROW 50001, 'Se requieren las tablas existentes dbo.USER y dbo.ROLE.', 1;
IF OBJECT_ID('dbo.AuthUsers', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.AuthUsers (
    Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
    Username NVARCHAR(100) NOT NULL,
    Email NVARCHAR(254) NOT NULL,
    Name NVARCHAR(150) NOT NULL,
    UserId INT NOT NULL REFERENCES dbo.[USER](user_id),
    PasswordHash VARCHAR(200) NULL,
    EntraObjectId UNIQUEIDENTIFIER NULL,
    IsActive BIT NOT NULL DEFAULT 1,
    CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_AuthUsers_Username UNIQUE (Username),
    CONSTRAINT UQ_AuthUsers_Email UNIQUE (Email),
    CONSTRAINT CK_AuthUsers_Username CHECK (Username NOT LIKE '%@%')
  );
  CREATE UNIQUE INDEX UQ_AuthUsers_Entra ON dbo.AuthUsers (EntraObjectId) WHERE EntraObjectId IS NOT NULL;
END;
IF OBJECT_ID('dbo.AuthSessions', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.AuthSessions (
    TokenHash CHAR(64) NOT NULL PRIMARY KEY,
    UserId UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.AuthUsers(Id),
    ExpiresAt DATETIME2 NOT NULL
  );
  CREATE INDEX IX_AuthSessions_ExpiresAt ON dbo.AuthSessions (ExpiresAt);
END;
