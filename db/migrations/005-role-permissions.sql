-- US13: configuración compartida por rol. Reejecutable sin sobrescribir cambios.
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF OBJECT_ID('dbo.ROLE', 'U') IS NULL
  THROW 50004, 'Se requiere dbo.ROLE.', 1;
IF OBJECT_ID('dbo.RoleModulePermissions', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.RoleModulePermissions (
    RoleId INT NOT NULL REFERENCES dbo.[ROLE](role_id),
    ModuleKey VARCHAR(30) NOT NULL,
    Level VARCHAR(10) NOT NULL,
    UpdatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_RoleModulePermissions PRIMARY KEY (RoleId, ModuleKey),
    CONSTRAINT CK_RoleModulePermissions_Module CHECK (ModuleKey IN ('app-builder', 'risks', 'reports')),
    CONSTRAINT CK_RoleModulePermissions_Level CHECK (Level IN ('hidden', 'read', 'edit')),
    CONSTRAINT CK_RoleModulePermissions_Admin CHECK (RoleId <> 2 OR Level = 'edit')
  );
END;
INSERT INTO dbo.RoleModulePermissions (RoleId, ModuleKey, Level)
SELECT r.role_id, m.ModuleKey,
  CASE WHEN r.role_id = 2 OR r.name = N'Administrador' THEN 'edit'
       WHEN r.name = N'Auditor' THEN CASE WHEN m.ModuleKey = 'reports' THEN 'read' ELSE 'edit' END
       WHEN r.name = N'Visualizador' THEN 'read'
       ELSE 'hidden' END
FROM dbo.[ROLE] r
CROSS JOIN (VALUES ('app-builder'), ('risks'), ('reports')) m(ModuleKey)
WHERE NOT EXISTS (SELECT 1 FROM dbo.RoleModulePermissions p WHERE p.RoleId = r.role_id AND p.ModuleKey = m.ModuleKey);
COMMIT;
