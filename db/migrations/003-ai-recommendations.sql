-- US15-US17 - Emiliano Carrizales: sugerencias del asistente de diseño y la decisión del usuario.
-- Ejecutar con `npm run ai:migrate`. Requiere 001-auth.sql. Puede ejecutarse nuevamente.
-- Tabla propia: no modifica AI_RECOMMENDATION ni otras tablas de la BD compartida.
IF OBJECT_ID('dbo.AuthUsers', 'U') IS NULL
  THROW 50003, 'Primero ejecuta npm run auth:migrate (se requiere dbo.AuthUsers).', 1;
IF OBJECT_ID('dbo.AppAiRecommendations', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.AppAiRecommendations (
    Id INT IDENTITY(1, 1) NOT NULL PRIMARY KEY,
    AppId NVARCHAR(100) NOT NULL,
    -- Agrupa las sugerencias que salieron del mismo "Analizar formulario".
    AnalysisId UNIQUEIDENTIFIER NOT NULL,
    Source VARCHAR(10) NOT NULL,
    Kind VARCHAR(20) NOT NULL,
    Title NVARCHAR(160) NOT NULL,
    Reason NVARCHAR(600) NOT NULL,
    Confidence VARCHAR(5) NOT NULL,
    FieldId NVARCHAR(100) NULL,
    -- Cambio propuesto (JSON) y, si el usuario lo reemplazó, el que aplicó.
    ProposedChange NVARCHAR(MAX) NULL,
    AppliedChange NVARCHAR(MAX) NULL,
    Status VARCHAR(10) NOT NULL DEFAULT 'pending',
    Provider VARCHAR(30) NOT NULL,
    PromptVersion VARCHAR(40) NULL,
    LatencyMs INT NULL,
    RequestedBy UNIQUEIDENTIFIER NULL REFERENCES dbo.AuthUsers(Id),
    DecidedBy UNIQUEIDENTIFIER NULL REFERENCES dbo.AuthUsers(Id),
    CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    DecidedAt DATETIME2 NULL,
    CONSTRAINT CK_AppAiRecommendations_Source CHECK (Source IN ('rules', 'ai')),
    CONSTRAINT CK_AppAiRecommendations_Kind CHECK (Kind IN ('inconsistency', 'component', 'field')),
    CONSTRAINT CK_AppAiRecommendations_Confidence CHECK (Confidence IN ('alta', 'media', 'baja')),
    CONSTRAINT CK_AppAiRecommendations_Status CHECK (Status IN ('pending', 'accepted', 'rejected', 'replaced')),
    CONSTRAINT CK_AppAiRecommendations_Proposed CHECK (ProposedChange IS NULL OR ISJSON(ProposedChange) = 1),
    CONSTRAINT CK_AppAiRecommendations_Applied CHECK (AppliedChange IS NULL OR ISJSON(AppliedChange) = 1)
  );
  CREATE INDEX IX_AppAiRecommendations_App ON dbo.AppAiRecommendations (AppId, CreatedAt);
  CREATE INDEX IX_AppAiRecommendations_Analysis ON dbo.AppAiRecommendations (AnalysisId);
END;
