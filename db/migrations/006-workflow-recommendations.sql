-- Fase 3 del workflow - Emiliano Carrizales: las sugerencias del asistente del flujo también se registran.
-- Ejecutar con `npm run ai:migrate` (corre 003 y luego esta). Puede ejecutarse nuevamente.
-- Solo toca dbo.AppAiRecommendations, la tabla propia del asistente; no modifica tablas de otros equipos.
--   Scope  = de qué pantalla salió la sugerencia ('designer' o 'workflow'); las filas que ya existen quedan en 'designer'.
--   Target = estado o transición al que se refiere (JSON), para el flujo.
--   Kind   = se agregan 'relation' y 'role' (sugerencias de la IA para el flujo).
IF OBJECT_ID('dbo.AppAiRecommendations', 'U') IS NULL
  THROW 50006, 'Primero ejecuta la migración 003 (dbo.AppAiRecommendations).', 1;

IF COL_LENGTH('dbo.AppAiRecommendations', 'Scope') IS NULL
  EXEC('ALTER TABLE dbo.AppAiRecommendations ADD Scope VARCHAR(10) NOT NULL
          CONSTRAINT DF_AppAiRecommendations_Scope DEFAULT ''designer''
          CONSTRAINT CK_AppAiRecommendations_Scope CHECK (Scope IN (''designer'', ''workflow''));');

IF COL_LENGTH('dbo.AppAiRecommendations', 'Target') IS NULL
  EXEC('ALTER TABLE dbo.AppAiRecommendations ADD Target NVARCHAR(300) NULL
          CONSTRAINT CK_AppAiRecommendations_Target CHECK (Target IS NULL OR ISJSON(Target) = 1);');

IF EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE name = 'CK_AppAiRecommendations_Kind' AND definition NOT LIKE '%relation%'
)
BEGIN
  ALTER TABLE dbo.AppAiRecommendations DROP CONSTRAINT CK_AppAiRecommendations_Kind;
  ALTER TABLE dbo.AppAiRecommendations ADD CONSTRAINT CK_AppAiRecommendations_Kind
    CHECK (Kind IN ('inconsistency', 'component', 'field', 'relation', 'role'));
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AppAiRecommendations_Scope')
  EXEC('CREATE INDEX IX_AppAiRecommendations_Scope ON dbo.AppAiRecommendations (AppId, Scope);');
