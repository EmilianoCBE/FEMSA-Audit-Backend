-- Fase 4 del workflow - Emiliano Carrizales: procesos en operación (un hallazgo recorriendo el flujo de su formulario).
-- Ejecutar con `npm run workflow:migrate`. Requiere 001-auth.sql y 002-app-versions.sql. Puede ejecutarse nuevamente.
-- Tablas propias: no modifica FINDING, WORKFLOW, TRANSITION ni otras tablas de la BD compartida (ver WORKFLOW-PROCESOS.md).
IF OBJECT_ID('dbo.AuthUsers', 'U') IS NULL OR OBJECT_ID('dbo.AppVersions', 'U') IS NULL
  THROW 50007, 'Primero ejecuta npm run auth:migrate y npm run versions:migrate.', 1;

-- Un proceso = un hallazgo que recorre el flujo. AppVersionId ancla la versión con la que empezó: el proceso termina
-- con ese flujo aunque después se publique otra versión (la configuración de AppVersions nunca cambia).
IF OBJECT_ID('dbo.AppWorkflowInstances', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.AppWorkflowInstances (
    Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
    AppId NVARCHAR(100) NOT NULL,
    AppVersionId INT NOT NULL REFERENCES dbo.AppVersions(Id),
    Title NVARCHAR(200) NOT NULL,
    CurrentStateId NVARCHAR(60) NOT NULL,
    Status VARCHAR(10) NOT NULL DEFAULT 'active',
    -- Desde cuándo está en el estado actual (para saber si se venció el plazo del estado).
    StateEnteredAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    StartedById UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.AuthUsers(Id),
    StartedByName NVARCHAR(150) NOT NULL,
    StartedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CompletedAt DATETIME2 NULL,
    CONSTRAINT CK_AppWorkflowInstances_Status CHECK (Status IN ('active', 'completed')),
    CONSTRAINT CK_AppWorkflowInstances_Completed CHECK (
      (Status = 'active' AND CompletedAt IS NULL) OR (Status = 'completed' AND CompletedAt IS NOT NULL)
    )
  );
  CREATE INDEX IX_AppWorkflowInstances_App ON dbo.AppWorkflowInstances (AppId, Status, StartedAt);
  CREATE INDEX IX_AppWorkflowInstances_Version ON dbo.AppWorkflowInstances (AppVersionId) WHERE Status = 'active';
END;

-- Historial: cada movimiento del proceso (quién, cuándo, de qué estado a cuál y con qué comentario / evidencia / plan).
IF OBJECT_ID('dbo.AppWorkflowHistory', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.AppWorkflowHistory (
    Id INT IDENTITY(1, 1) NOT NULL PRIMARY KEY,
    InstanceId UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.AppWorkflowInstances(Id),
    -- NULL en el registro de inicio del proceso.
    TransitionId NVARCHAR(60) NULL,
    Action NVARCHAR(60) NOT NULL,
    FromStateId NVARCHAR(60) NULL,
    ToStateId NVARCHAR(60) NOT NULL,
    ActorId UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.AuthUsers(Id),
    ActorName NVARCHAR(150) NOT NULL,
    -- Rol del flujo con el que actuó (Auditor, Jefe de Auditoría, ...).
    ActorRole NVARCHAR(60) NULL,
    Comment NVARCHAR(1000) NULL,
    Evidence NVARCHAR(500) NULL,
    ActionPlan NVARCHAR(MAX) NULL,
    At DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_AppWorkflowHistory_Plan CHECK (ActionPlan IS NULL OR ISJSON(ActionPlan) = 1)
  );
  CREATE INDEX IX_AppWorkflowHistory_Instance ON dbo.AppWorkflowHistory (InstanceId, Id);
END;
