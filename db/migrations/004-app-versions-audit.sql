-- US11 - Rafael Valdez: quién publicó o descartó cada versión, y el estado 'discarded'.
-- Ejecutar con `npm run versions:migrate` (corre 002 y luego este). Puede ejecutarse nuevamente.
-- Descartar un borrador no borra la fila: así los números de versión nunca se reutilizan y queda rastro.
-- Las columnas *ById no llevan llave foránea: el nombre ya se copia en *ByName para mostrarlo.
IF OBJECT_ID('dbo.AppVersions', 'U') IS NULL
  THROW 50004, 'Primero ejecuta 002-app-versions.sql (se requiere dbo.AppVersions).', 1;

IF COL_LENGTH('dbo.AppVersions', 'PublishedById') IS NULL
  ALTER TABLE dbo.AppVersions ADD
    PublishedById UNIQUEIDENTIFIER NULL,
    PublishedByName NVARCHAR(150) NULL,
    DiscardedAt DATETIME2 NULL,
    DiscardedById UNIQUEIDENTIFIER NULL,
    DiscardedByName NVARCHAR(150) NULL;

IF NOT EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE name = 'CK_AppVersions_Status' AND definition LIKE '%discarded%'
)
BEGIN
  ALTER TABLE dbo.AppVersions DROP CONSTRAINT CK_AppVersions_Status;
  ALTER TABLE dbo.AppVersions ADD CONSTRAINT CK_AppVersions_Status
    CHECK (Status IN ('draft', 'current', 'archived', 'discarded'));
END;
