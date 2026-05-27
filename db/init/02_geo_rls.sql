/*
 * 2026-04-23 · Geographic catalog + assignment (DIVIPOLA-based)
 * 2026-05-10 · REFACTORED: Agregado product_id FK para vincular zonas a productos
 * 
 * IDEMPOTENTE: Este script puede ejecutarse múltiples veces sin error.
 * Verifica existencia de objetos antes de crearlos/modificarlos.
 */

USE [sqldb-ingenial-ia];
GO

SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET NUMERIC_ROUNDABORT OFF;
GO

SET XACT_ABORT ON;
SET NOCOUNT ON;
GO

PRINT '[02_geo_rls] Iniciando setup de catálogo geográfico y User_Zones...';

-- ============================================================================
-- 1. Divipola — catálogo geográfico nacional (DANE)
-- ============================================================================
IF OBJECT_ID('dbo.Divipola', 'U') IS NULL
BEGIN
    PRINT '[02] Creando tabla dbo.Divipola...';
    CREATE TABLE dbo.Divipola (
        id        INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        cod_dep   CHAR(2)            NOT NULL,
        nom_dep   NVARCHAR(80)       NOT NULL,
        cod_mun   CHAR(5)            NOT NULL,
        nom_mun   NVARCHAR(120)      NOT NULL,
        updated_at DATETIME2(0)      NOT NULL
            CONSTRAINT DF_Divipola_updated DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_Divipola_cod_mun  UNIQUE (cod_mun),
        CONSTRAINT CK_Divipola_codes    CHECK (LEFT(cod_mun, 2) = cod_dep)
    );
    CREATE INDEX IX_Divipola_dep ON dbo.Divipola(cod_dep);
    PRINT '[02] Tabla dbo.Divipola creada.';
END
ELSE
BEGIN
    PRINT '[02] Tabla dbo.Divipola ya existe.';
END;
GO

-- ============================================================================
-- 2. User_Zones — zonas geográficas POR PRODUCTO (IDEMPOTENTE)
-- ============================================================================
IF OBJECT_ID('dbo.User_Zones', 'U') IS NULL
BEGIN
    PRINT '[02] Creando tabla dbo.User_Zones...';
    CREATE TABLE dbo.User_Zones (
        id          INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        user_id     NVARCHAR(64)      NOT NULL,
        product_id  INT               NULL,
        cod_dep     CHAR(2)           NOT NULL,
        cod_mun     CHAR(5)           NULL,
        enable      BIT               NOT NULL
            CONSTRAINT DF_UZ_enable DEFAULT 1,
        created_at  DATETIME2(0)      NOT NULL
            CONSTRAINT DF_UZ_created DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_UZ_codes CHECK (
            cod_mun IS NULL
            OR LEFT(cod_mun, 2) = cod_dep
        )
    );
    PRINT '[02] Tabla dbo.User_Zones creada sin FK (se agregará después).';
END
ELSE
BEGIN
    PRINT '[02] Tabla dbo.User_Zones ya existe.';
    
    -- Si la tabla ya existe, asegurarse de que product_id existe
    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = 'User_Zones' AND COLUMN_NAME = 'product_id'
    )
    BEGIN
        PRINT '[02] Agregando columna product_id a dbo.User_Zones...';
        ALTER TABLE dbo.User_Zones ADD product_id INT NULL;
    END;
END;
GO

-- Agregar FK a Products (solo si la tabla Products existe y product_id está presente)
IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'User_Zones' AND COLUMN_NAME = 'product_id'
)
   AND EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME = 'Products'
)
   AND NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_NAME = 'User_Zones' AND CONSTRAINT_NAME = 'FK_UZ_product'
)
BEGIN
    PRINT '[02] Agregando FK: dbo.User_Zones.product_id -> dbo.Products(id)...';
    ALTER TABLE dbo.User_Zones
    ADD CONSTRAINT FK_UZ_product FOREIGN KEY (product_id)
        REFERENCES dbo.Products(id) ON DELETE CASCADE;
    PRINT '[02] FK agregada.';
END;
GO

-- Crear índices (idempotente)
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_UZ_user_enabled' AND object_id = OBJECT_ID('dbo.User_Zones')
)
BEGIN
    PRINT '[02] Creando índice IX_UZ_user_enabled...';
    CREATE INDEX IX_UZ_user_enabled ON dbo.User_Zones(user_id) WHERE enable = 1;
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_UZ_user_dep' AND object_id = OBJECT_ID('dbo.User_Zones')
)
BEGIN
    PRINT '[02] Creando índice IX_UZ_user_dep...';
    CREATE INDEX IX_UZ_user_dep ON dbo.User_Zones(user_id, cod_dep);
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_UZ_product_user' AND object_id = OBJECT_ID('dbo.User_Zones')
)
BEGIN
    PRINT '[02] Creando índice IX_UZ_product_user...';
    CREATE INDEX IX_UZ_product_user ON dbo.User_Zones(product_id, user_id)
        INCLUDE (cod_dep, cod_mun, enable);
END;
GO

-- ============================================================================
-- 3. Stored Procedures (lectura y upsert de asignaciones)
-- ============================================================================

IF OBJECT_ID('dbo.GetUserZonesForProduct', 'P') IS NULL
    EXEC sp_executesql N'CREATE PROCEDURE dbo.GetUserZonesForProduct AS BEGIN SELECT 1; END';
GO

ALTER PROCEDURE dbo.GetUserZonesForProduct
    @product_id INT
AS
BEGIN
    SET NOCOUNT ON;

    ;WITH effective AS (
        SELECT uz.cod_dep, uz.cod_mun
          FROM dbo.User_Zones uz
         WHERE uz.product_id = @product_id
           AND uz.enable  = 1
           AND uz.cod_mun IS NOT NULL

        UNION

        SELECT d.cod_dep, d.cod_mun
          FROM dbo.User_Zones uz
          JOIN dbo.Divipola d ON d.cod_dep = uz.cod_dep
         WHERE uz.product_id = @product_id
           AND uz.enable  = 1
           AND uz.cod_mun IS NULL
    )
    SELECT cod_dep, cod_mun FROM effective;
END;
GO

IF OBJECT_ID('dbo.GetUserZones', 'P') IS NULL
    EXEC sp_executesql N'CREATE PROCEDURE dbo.GetUserZones AS BEGIN SELECT 1; END';
GO

ALTER PROCEDURE dbo.GetUserZones
    @user_id NVARCHAR(64)
AS
BEGIN
    SET NOCOUNT ON;

    ;WITH effective AS (
        SELECT uz.cod_dep, uz.cod_mun
          FROM dbo.User_Zones uz
         WHERE uz.user_id = @user_id
           AND uz.enable  = 1
           AND uz.cod_mun IS NOT NULL

        UNION

        SELECT d.cod_dep, d.cod_mun
          FROM dbo.User_Zones uz
          JOIN dbo.Divipola d ON d.cod_dep = uz.cod_dep
         WHERE uz.user_id = @user_id
           AND uz.enable  = 1
           AND uz.cod_mun IS NULL
    )
    SELECT cod_dep, cod_mun FROM effective;
END;
GO

PRINT '[02_geo_rls] Setup completado.';
GO
