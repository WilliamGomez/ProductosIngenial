/*
 * Geographic catalog + assignment (Registraduria DIVIPOLA Electoral)
 *
 * Canonical model:
 *   - dbo.DIVIPOLA keeps the electoral dataset column names.
 *   - dbo.User_Zones stores app-level grants as cod_dep and local cod_mun.
 *   - User_Zones.cod_dep maps to DIVIPOLA.dep.
 *   - User_Zones.cod_mun maps to DIVIPOLA.mun.
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
SET XACT_ABORT ON;
SET NOCOUNT ON;
GO

-- Remove invented/staging tables and legacy catalogs.
IF OBJECT_ID('dbo.DIVIPOLA NEXT', 'U') IS NOT NULL DROP TABLE [dbo].[DIVIPOLA NEXT];
IF OBJECT_ID('dbo.DIVIPOLA_next', 'U') IS NOT NULL DROP TABLE dbo.DIVIPOLA_next;
DROP TABLE IF EXISTS dbo.Municipalities;
DROP TABLE IF EXISTS dbo.Departments;
GO

-- Drop strict FKs to DIVIPOLA. User_Zones.cod_mun is local mun, while the
-- electoral table stores dep and mun separately and can have many rows per
-- municipality because of polling places.
DECLARE @sql NVARCHAR(MAX) = N'';
SELECT @sql = @sql + N'ALTER TABLE dbo.User_Zones DROP CONSTRAINT '
    + QUOTENAME(fk.name) + N';' + CHAR(13)
FROM sys.foreign_keys fk
WHERE fk.parent_object_id = OBJECT_ID(N'dbo.User_Zones')
  AND fk.referenced_object_id IN (
      OBJECT_ID(N'dbo.DIVIPOLA'),
      OBJECT_ID(N'dbo.Divipola')
  );
IF @sql <> N'' EXEC sp_executesql @sql;
GO

DECLARE @checkSql NVARCHAR(MAX) = N'';
SELECT @checkSql = @checkSql + N'ALTER TABLE dbo.User_Zones DROP CONSTRAINT '
    + QUOTENAME(cc.name) + N';' + CHAR(13)
FROM sys.check_constraints cc
WHERE cc.parent_object_id = OBJECT_ID(N'dbo.User_Zones')
  AND cc.definition LIKE '%cod_mun%'
  AND cc.definition LIKE '%cod_dep%';
IF @checkSql <> N'' EXEC sp_executesql @checkSql;
GO

IF OBJECT_ID('dbo.Divipola', 'U') IS NOT NULL
   AND OBJECT_ID('dbo.DIVIPOLA', 'U') IS NULL
BEGIN
    EXEC sp_rename 'dbo.Divipola', 'DIVIPOLA';
END;
GO

IF OBJECT_ID('dbo.DIVIPOLA', 'U') IS NOT NULL
   AND (
       COL_LENGTH('dbo.DIVIPOLA', 'dep') IS NULL
       OR COL_LENGTH('dbo.DIVIPOLA', 'mun') IS NULL
       OR COL_LENGTH('dbo.DIVIPOLA', 'nom_dep') IS NULL
       OR COL_LENGTH('dbo.DIVIPOLA', 'nom_mun') IS NULL
       OR COL_LENGTH('dbo.DIVIPOLA', 'cod_dep') IS NOT NULL
       OR COL_LENGTH('dbo.DIVIPOLA', 'cod_mun') IS NOT NULL
       OR COL_LENGTH('dbo.DIVIPOLA', 'departamento') IS NOT NULL
       OR COL_LENGTH('dbo.DIVIPOLA', 'municipio') IS NOT NULL
   )
BEGIN
    DROP TABLE dbo.DIVIPOLA;
END;
GO

IF OBJECT_ID('dbo.DIVIPOLA', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.DIVIPOLA (
        cod_eleccion VARCHAR(20)  NOT NULL,
        dep          VARCHAR(2)   NOT NULL,
        nom_dep      VARCHAR(150) NOT NULL,
        mun          VARCHAR(3)   NOT NULL,
        nom_mun      VARCHAR(150) NOT NULL,
        zz           VARCHAR(2)   NULL,
        pp           VARCHAR(2)   NULL,
        nom_puesto   VARCHAR(150) NULL
    );

END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_DIVIPOLA_Geo'
      AND object_id = OBJECT_ID('dbo.DIVIPOLA')
)
BEGIN
    CREATE INDEX IX_DIVIPOLA_Geo ON dbo.DIVIPOLA(dep, mun);
END;
GO

IF OBJECT_ID('dbo.User_Zones', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.User_Zones (
        id          INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        user_id     NVARCHAR(64)      NOT NULL,
        product_id  INT               NULL,
        cod_dep     VARCHAR(2)        NOT NULL,
        cod_mun     VARCHAR(3)        NULL,
        enable      BIT               NOT NULL
            CONSTRAINT DF_UZ_enable DEFAULT 1,
        created_at  DATETIME2(0)      NOT NULL
            CONSTRAINT DF_UZ_created DEFAULT SYSUTCDATETIME(),

        CONSTRAINT FK_UZ_product FOREIGN KEY (product_id)
            REFERENCES dbo.Products(id) ON DELETE CASCADE
    );

    CREATE INDEX IX_UZ_user_enabled ON dbo.User_Zones(user_id) WHERE enable = 1;
    CREATE INDEX IX_UZ_user_dep ON dbo.User_Zones(user_id, cod_dep);
    CREATE INDEX IX_UZ_product_user ON dbo.User_Zones(product_id, user_id)
        INCLUDE (cod_dep, cod_mun, enable);
END;
GO

IF OBJECT_ID('dbo.User_Zones', 'U') IS NOT NULL
BEGIN
    IF COL_LENGTH('dbo.User_Zones', 'cod_mun') IS NOT NULL
    BEGIN
        IF EXISTS (
            SELECT 1 FROM sys.indexes
            WHERE name = 'IX_UZ_product_user'
              AND object_id = OBJECT_ID('dbo.User_Zones')
        )
            DROP INDEX IX_UZ_product_user ON dbo.User_Zones;

        UPDATE dbo.User_Zones
           SET cod_mun = RIGHT(cod_mun, 3)
         WHERE cod_mun IS NOT NULL
           AND LEN(cod_mun) > 3;

        ALTER TABLE dbo.User_Zones ALTER COLUMN cod_mun VARCHAR(3) NULL;

        IF NOT EXISTS (
            SELECT 1 FROM sys.indexes
            WHERE name = 'IX_UZ_product_user'
              AND object_id = OBJECT_ID('dbo.User_Zones')
        )
            CREATE INDEX IX_UZ_product_user ON dbo.User_Zones(product_id, user_id)
                INCLUDE (cod_dep, cod_mun, enable);
    END;
END;
GO

CREATE OR ALTER PROCEDURE dbo.GetUserZonesForProduct
    @product_id INT
AS
BEGIN
    SET NOCOUNT ON;

    ;WITH effective AS (
        SELECT uz.cod_dep, uz.cod_mun
          FROM dbo.User_Zones uz
         WHERE uz.product_id = @product_id
           AND uz.enable = 1
           AND uz.cod_mun IS NOT NULL

        UNION

        SELECT DISTINCT d.dep AS cod_dep, d.mun AS cod_mun
          FROM dbo.User_Zones uz
          JOIN dbo.DIVIPOLA d ON d.dep = uz.cod_dep
         WHERE uz.product_id = @product_id
           AND uz.enable = 1
           AND uz.cod_mun IS NULL
    )
    SELECT cod_dep, cod_mun FROM effective;
END;
GO

CREATE OR ALTER PROCEDURE dbo.GetUserZones
    @user_id NVARCHAR(64)
AS
BEGIN
    SET NOCOUNT ON;

    ;WITH effective AS (
        SELECT uz.cod_dep, uz.cod_mun
          FROM dbo.User_Zones uz
         WHERE uz.user_id = @user_id
           AND uz.enable = 1
           AND uz.cod_mun IS NOT NULL

        UNION

        SELECT DISTINCT d.dep AS cod_dep, d.mun AS cod_mun
          FROM dbo.User_Zones uz
          JOIN dbo.DIVIPOLA d ON d.dep = uz.cod_dep
         WHERE uz.user_id = @user_id
           AND uz.enable = 1
           AND uz.cod_mun IS NULL
    )
    SELECT cod_dep, cod_mun FROM effective;
END;
GO

CREATE OR ALTER PROCEDURE dbo.UpsertUserZonesForProduct
    @product_id INT,
    @assignments NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRAN;

    UPDATE dbo.User_Zones SET enable = 0 WHERE product_id = @product_id;

    INSERT INTO dbo.User_Zones (user_id, product_id, cod_dep, cod_mun, enable)
    SELECT
        (SELECT user_id FROM dbo.Products WHERE id = @product_id),
        @product_id,
        JSON_VALUE(j.value, '$.cod_dep'),
        RIGHT(NULLIF(JSON_VALUE(j.value, '$.cod_mun'), ''), 3),
        1
      FROM OPENJSON(@assignments) AS j;

    COMMIT;
END;
GO

CREATE OR ALTER PROCEDURE dbo.UpsertUserZones
    @user_id NVARCHAR(64),
    @assignments NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRAN;

    UPDATE dbo.User_Zones SET enable = 0 WHERE user_id = @user_id;

    INSERT INTO dbo.User_Zones (user_id, product_id, cod_dep, cod_mun, enable)
    SELECT
        @user_id,
        NULL,
        JSON_VALUE(j.value, '$.cod_dep'),
        RIGHT(NULLIF(JSON_VALUE(j.value, '$.cod_mun'), ''), 3),
        1
      FROM OPENJSON(@assignments) AS j;

    COMMIT;
END;
GO

CREATE OR ALTER PROCEDURE dbo.ListDepartments
AS
BEGIN
    SET NOCOUNT ON;
    SELECT DISTINCT
        dep AS dpto,
        nom_dep AS nom_dpto
    FROM dbo.DIVIPOLA
    ORDER BY nom_dep;
END;
GO

CREATE OR ALTER PROCEDURE dbo.ListMunicipalities
AS
BEGIN
    SET NOCOUNT ON;
    SELECT DISTINCT
        dep AS dpto,
        (dep + mun) AS mpio,
        nom_mun AS nombre_mpi
    FROM dbo.DIVIPOLA
    ORDER BY nom_mun;
END;
GO

PRINT '[02_geo_rls] dbo.DIVIPOLA electoral + dbo.User_Zones ready.';
GO

/*
ROLLBACK (manual)
DROP PROCEDURE IF EXISTS dbo.ListMunicipalities;
DROP PROCEDURE IF EXISTS dbo.ListDepartments;
DROP PROCEDURE IF EXISTS dbo.UpsertUserZones;
DROP PROCEDURE IF EXISTS dbo.UpsertUserZonesForProduct;
DROP PROCEDURE IF EXISTS dbo.GetUserZones;
DROP PROCEDURE IF EXISTS dbo.GetUserZonesForProduct;
DROP TABLE IF EXISTS dbo.User_Zones;
DROP TABLE IF EXISTS dbo.DIVIPOLA;
*/
