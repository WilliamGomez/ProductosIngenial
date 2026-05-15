/*
 * 2026-04-23 · Geographic Row-Level Security
 * -----------------------------------------------------------------------------
 * Cierra hallazgos:
 *   · C-05 (GET /power-bi sin autenticación)  — vía backend, este script habilita
 *           la infraestructura para la EffectiveIdentity.
 *   · A-08 (bypass de autorización en /power-bi/{id}) — la tabla `User_Zones`
 *           provee la fuente de verdad geográfica que el rol DAX `GeoScope`
 *           consume para aplicar RLS server-side.
 *
 * Orden de ejecución:
 *   1. Crear catálogo de Zonas.
 *   2. Crear tabla intermedia User_Zones.
 *   3. Crear SPs de lectura/upsert.
 *   4. (manual) Backfill de 2-3 usuarios piloto antes de activar RLS en .pbix.
 *
 * Reversibilidad: ver bloque al final del archivo.
 * =============================================================================
 */

SET XACT_ABORT ON;
SET NOCOUNT ON;
GO

BEGIN TRAN;

-- -----------------------------------------------------------------------------
-- 1. Catálogo de Zonas (granularidad fina: puestos de votación, veredas, etc.)
-- -----------------------------------------------------------------------------
IF OBJECT_ID('dbo.Zones', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Zones (
        id       INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        cod_zona NVARCHAR(32)      NOT NULL,
        cod_mun  NVARCHAR(32)      NOT NULL,   -- FK lógica a Municipalities.code
        cod_dep  NVARCHAR(32)      NOT NULL,   -- denormalizado para filtros
        name     NVARCHAR(128)     NOT NULL,
        CONSTRAINT UQ_Zones_codes UNIQUE (cod_zona, cod_mun)
    );
    CREATE INDEX IX_Zones_mun ON dbo.Zones(cod_mun);
    CREATE INDEX IX_Zones_dep ON dbo.Zones(cod_dep);
END;
GO

-- -----------------------------------------------------------------------------
-- 2. Tabla intermedia: asignación usuario ↔ zona (jerárquica)
-- -----------------------------------------------------------------------------
IF OBJECT_ID('dbo.User_Zones', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.User_Zones (
        id          INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        user_id     NVARCHAR(64)       NOT NULL,     -- Azure AD oid
        scope_level NVARCHAR(16)       NOT NULL,     -- 'department' | 'municipality' | 'zone'
        cod_dep     NVARCHAR(32)       NULL,
        cod_mun     NVARCHAR(32)       NULL,
        cod_zona    NVARCHAR(32)       NULL,
        enable      BIT                NOT NULL CONSTRAINT DF_UZ_enable DEFAULT 1,
        created_at  DATETIME2(0)       NOT NULL CONSTRAINT DF_UZ_created DEFAULT SYSUTCDATETIME(),

        CONSTRAINT CK_UZ_level CHECK (scope_level IN ('department','municipality','zone')),
        CONSTRAINT CK_UZ_codes CHECK (
            (scope_level = 'department'   AND cod_dep  IS NOT NULL AND cod_mun  IS NULL AND cod_zona IS NULL) OR
            (scope_level = 'municipality' AND cod_mun  IS NOT NULL AND cod_zona IS NULL)                       OR
            (scope_level = 'zone'         AND cod_zona IS NOT NULL)
        )
    );

    -- Índice para la ruta caliente (GetUserZones)
    CREATE INDEX IX_UZ_user_enabled ON dbo.User_Zones(user_id) WHERE enable = 1;
END;
GO

-- -----------------------------------------------------------------------------
-- 3. SPs
-- -----------------------------------------------------------------------------

-- 3.1. GetUserZones — expande jerarquía (department → todas sus zonas, etc.)
CREATE OR ALTER PROCEDURE dbo.GetUserZones
    @user_id NVARCHAR(64)
AS
BEGIN
    SET NOCOUNT ON;

    ;WITH effective AS (
        -- Filas 'zone' tal cual
        SELECT uz.cod_dep, uz.cod_mun, uz.cod_zona
          FROM dbo.User_Zones uz
         WHERE uz.user_id = @user_id
           AND uz.enable = 1
           AND uz.scope_level = 'zone'

        UNION

        -- 'municipality' → expandir todas las zonas del municipio
        SELECT z.cod_dep, z.cod_mun, z.cod_zona
          FROM dbo.User_Zones uz
          JOIN dbo.Zones z ON z.cod_mun = uz.cod_mun
         WHERE uz.user_id = @user_id
           AND uz.enable = 1
           AND uz.scope_level = 'municipality'

        UNION

        -- 'department' → expandir todas las zonas del departamento
        SELECT z.cod_dep, z.cod_mun, z.cod_zona
          FROM dbo.User_Zones uz
          JOIN dbo.Zones z ON z.cod_dep = uz.cod_dep
         WHERE uz.user_id = @user_id
           AND uz.enable = 1
           AND uz.scope_level = 'department'
    )
    SELECT cod_dep, cod_mun, cod_zona
      FROM effective;
END;
GO

-- 3.2. UpsertUserZones — idempotente, recibe JSON array
-- Formato: [{"level":"department","cod_dep":"05"},
--          {"level":"municipality","cod_dep":"05","cod_mun":"05001"},
--          {"level":"zone","cod_dep":"05","cod_mun":"05001","cod_zona":"00123"}]
CREATE OR ALTER PROCEDURE dbo.UpsertUserZones
    @user_id     NVARCHAR(64),
    @assignments NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRAN;

    -- Soft delete previo
    UPDATE dbo.User_Zones
       SET enable = 0
     WHERE user_id = @user_id;

    -- Insertar nuevas asignaciones
    INSERT INTO dbo.User_Zones (user_id, scope_level, cod_dep, cod_mun, cod_zona, enable)
    SELECT @user_id,
           JSON_VALUE(j.value, '$.level'),
           JSON_VALUE(j.value, '$.cod_dep'),
           JSON_VALUE(j.value, '$.cod_mun'),
           JSON_VALUE(j.value, '$.cod_zona'),
           1
      FROM OPENJSON(@assignments) AS j;

    COMMIT;
END;
GO

COMMIT;
GO

-- =============================================================================
-- ROLLBACK (ejecutar manualmente si hay que revertir)
-- =============================================================================
/*
DROP PROCEDURE IF EXISTS dbo.UpsertUserZones;
DROP PROCEDURE IF EXISTS dbo.GetUserZones;
DROP TABLE     IF EXISTS dbo.User_Zones;
DROP TABLE     IF EXISTS dbo.Zones;
*/
