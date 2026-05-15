/*
 * 07_divipola_single_master.sql
 * Corrects DIVIPOLA to the Registraduria electoral shape.
 *
 * Important:
 *   - dbo.DIVIPOLA keeps dep/nom_dep/mun/nom_mun/zz/pp/nom_puesto.
 *   - dbo.User_Zones.cod_dep maps to DIVIPOLA.dep.
 *   - dbo.User_Zones.cod_mun maps to DIVIPOLA.mun.
 *   - No strict FK is created from User_Zones.cod_mun to DIVIPOLA.
 */

USE [sqldb-ingenial-ia];
GO

SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET XACT_ABORT ON;
SET NOCOUNT ON;
GO

IF OBJECT_ID('dbo.DIVIPOLA NEXT', 'U') IS NOT NULL DROP TABLE [dbo].[DIVIPOLA NEXT];
IF OBJECT_ID('dbo.DIVIPOLA_next', 'U') IS NOT NULL DROP TABLE dbo.DIVIPOLA_next;
GO

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

DROP TABLE IF EXISTS dbo.Municipalities;
DROP TABLE IF EXISTS dbo.Departments;
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

IF OBJECT_ID('dbo.User_Zones', 'U') IS NOT NULL
BEGIN
    IF COL_LENGTH('dbo.User_Zones', 'cod_dep') IS NOT NULL
        ALTER TABLE dbo.User_Zones ALTER COLUMN cod_dep VARCHAR(2) NOT NULL;

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

PRINT '[07_divipola_single_master] dbo.DIVIPOLA electoral catalog ready.';
GO
