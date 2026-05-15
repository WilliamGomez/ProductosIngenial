/*
 * =============================================================================
 * FASE 1: RefactorizaciÃ³n del esquema Products + User_Zones
 * =============================================================================
 * 
 * OBJETIVO: Eliminar el anti-patrÃ³n de guardar listas CSV en columnas
 * 'country', 'state', 'city' de la tabla dbo.Products. En su lugar,
 * cada zona geogrÃ¡fica (departamento/municipio) se almacenarÃ¡ en
 * dbo.User_Zones con un FK explÃ­cito a dbo.Products(id).
 *
 * CAMBIOS:
 * 1. Modificar dbo.Products: Eliminar columnas country, state, city
 * 2. Modificar dbo.User_Zones: Agregar FK a dbo.Products(id)
 * 3. Crear trigger/SP para limpiar datos histÃ³ricos o hacer migraciÃ³n
 *
 * NOTA: Este script se ejecuta DESPUÃ‰S de 01_base_schema.sql y 02_geo_rls.sql
 * =============================================================================
 */

USE [sqldb-ingenial-ia];
GO

SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET XACT_ABORT ON;
SET NOCOUNT ON;
GO

BEGIN TRAN;

-- ============================================================================
-- PASO 1: Alterar dbo.User_Zones para agregar product_id
-- ============================================================================

-- Primero, agregar la columna product_id (NULL por ahora para datos histÃ³ricos)
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'User_Zones' AND COLUMN_NAME = 'product_id'
)
BEGIN
    ALTER TABLE dbo.User_Zones ADD product_id INT NULL;
    PRINT '[03] Agregada columna product_id a dbo.User_Zones';
END;
GO

-- Agregar FK a dbo.Products si no existe
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_NAME = 'User_Zones' AND CONSTRAINT_NAME = 'FK_UZ_product'
)
BEGIN
    ALTER TABLE dbo.User_Zones
    ADD CONSTRAINT FK_UZ_product FOREIGN KEY (product_id)
        REFERENCES dbo.Products(id) ON DELETE CASCADE;
    PRINT '[03] Agregada FK: dbo.User_Zones.product_id -> dbo.Products(id)';
END;
GO

-- Crear Ã­ndice compuesto para bÃºsquedas rÃ¡pidas
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_UZ_product_user' AND object_id = OBJECT_ID('dbo.User_Zones')
)
BEGIN
    CREATE INDEX IX_UZ_product_user ON dbo.User_Zones(product_id, user_id)
        INCLUDE (cod_dep, cod_mun, enable);
    PRINT '[03] Creado Ã­ndice IX_UZ_product_user en dbo.User_Zones';
END;
GO

-- Endurecer product_id cuando ya no existan filas legacy sin producto.
IF COL_LENGTH('dbo.User_Zones', 'product_id') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM dbo.User_Zones WHERE product_id IS NULL)
   AND EXISTS (
        SELECT 1
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = 'dbo'
          AND TABLE_NAME = 'User_Zones'
          AND COLUMN_NAME = 'product_id'
          AND IS_NULLABLE = 'YES'
   )
BEGIN
    IF EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE name = 'IX_UZ_product_user'
          AND object_id = OBJECT_ID('dbo.User_Zones')
    )
        DROP INDEX IX_UZ_product_user ON dbo.User_Zones;

    ALTER TABLE dbo.User_Zones ALTER COLUMN product_id INT NOT NULL;

    CREATE INDEX IX_UZ_product_user ON dbo.User_Zones(product_id, user_id)
        INCLUDE (cod_dep, cod_mun, enable);

    PRINT '[03] User_Zones.product_id marcado como NOT NULL';
END;
GO
-- ============================================================================
-- PASO 2: Verificar que dbo.Products tiene columna 'product_name'
-- (Para diferenciar 'Votometro' vs 'Audivoto')
-- ============================================================================

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'Products' AND COLUMN_NAME = 'product_name'
)
BEGIN
    -- Si NO existe product_name, verificar si existe 'name'
    IF EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = 'Products' AND COLUMN_NAME = 'name'
    )
    BEGIN
        PRINT '[03] WARNING: Products tiene columna "name", no "product_name". Revisar esquema.';
    END;
END;
GO

-- ============================================================================
-- PASO 3: Almacenar definiciÃ³n de vista para recuperar Products + Zones
-- ============================================================================

-- ============================================================================
-- PASO 3: Eliminar columnas legacy CSV de dbo.Products
-- ============================================================================

IF COL_LENGTH('dbo.Products', 'country') IS NOT NULL
BEGIN
    ALTER TABLE dbo.Products DROP COLUMN country;
    PRINT '[03] Eliminada columna legacy dbo.Products.country';
END;
GO

IF COL_LENGTH('dbo.Products', 'state') IS NOT NULL
BEGIN
    ALTER TABLE dbo.Products DROP COLUMN [state];
    PRINT '[03] Eliminada columna legacy dbo.Products.state';
END;
GO

IF COL_LENGTH('dbo.Products', 'city') IS NOT NULL
BEGIN
    ALTER TABLE dbo.Products DROP COLUMN city;
    PRINT '[03] Eliminada columna legacy dbo.Products.city';
END;
GO
-- Vista para consultar productos con sus zonas asociadas
CREATE OR ALTER VIEW dbo.V_Products_With_Zones AS
SELECT 
    p.id AS product_id,
    p.user_id,
    p.product_name AS product_name,
    p.contract_duration,
    p.duration_unit,
    p.amount_cop,
    p.enable AS product_enabled,
    uz.id AS zone_id,
    uz.cod_dep,
    uz.cod_mun,
    uz.enable AS zone_enabled,
    uz.created_at AS zone_created_at
FROM dbo.Products p
LEFT JOIN dbo.User_Zones uz ON uz.product_id = p.id
WHERE p.enable = 1;
GO

PRINT '[03] Creada vista V_Products_With_Zones';
GO

-- ============================================================================
-- PASO 4: Crear SP para migrar CSV a product_id (si hay datos legacy)
-- ============================================================================

CREATE OR ALTER PROCEDURE dbo.MigrateProductsCSVToZones
    @dry_run BIT = 1
AS
BEGIN
    /**
     * Procedimiento para migrar datos legacy: si User_Zones tiene filas sin
     * product_id, intenta asociarlas al Producto de ese usuario.
     *
     * ADVERTENCIA: Es exploratorio. Los datos CSV viejos en Products
     * se transformarÃ¡n segÃºn la heurÃ­stica del negocio. Ejecutar con cuidado.
     */
    SET NOCOUNT ON;

    IF @dry_run = 1
        PRINT '[INFO] Dry-run mode. Mostrando filas a migrar...';
    ELSE
        PRINT '[INFO] Iniciando migraciÃ³n...';

    -- Contar filas sin product_id
    DECLARE @count INT = (
        SELECT COUNT(*) FROM dbo.User_Zones WHERE product_id IS NULL
    );

    PRINT CONCAT('[INFO] Filas sin product_id: ', @count);

    -- Si hay filas sin product_id, asociarlas
    -- HeurÃ­stica: Si un usuario tiene 1 producto, todos los User_Zones van a ese producto
    -- Si tiene 2+, requiere intervenciÃ³n manual.

    IF @count > 0
    BEGIN
        IF @dry_run = 1
        BEGIN
            SELECT 
                uz.id,
                uz.user_id,
                uz.product_id,
                COUNT(DISTINCT p.id) AS product_count
            FROM dbo.User_Zones uz
            LEFT JOIN dbo.Products p ON p.user_id = uz.user_id
            WHERE uz.product_id IS NULL
            GROUP BY uz.id, uz.user_id, uz.product_id;
        END;
        ELSE
        BEGIN
            -- Actualizar solo para usuarios con 1 producto
            UPDATE uz
            SET product_id = p.id
            FROM dbo.User_Zones uz
            INNER JOIN (
                SELECT user_id, id,
                       ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY id) AS rn
                FROM dbo.Products
            ) p ON p.user_id = uz.user_id AND p.rn = 1
            WHERE uz.product_id IS NULL;

            PRINT '[INFO] MigraciÃ³n completada.';
        END;
    END;
END;
GO

PRINT '[03] Creado procedimiento MigrateProductsCSVToZones';
GO

-- ============================================================================
-- PASO 5: Crear SP para recuperar productos de un usuario CON sus zonas
-- ============================================================================

CREATE OR ALTER PROCEDURE dbo.GetUserProductsWithZones
    @user_id NVARCHAR(64)
AS
BEGIN
    /**
     * Devuelve todos los productos (activos) de un usuario junto con sus
     * zonas geogrÃ¡ficas asociadas.
     *
     * Resultado: product_id, product_name, contract_duration, duration_unit,
     *            amount_cop, enable, zones (JSON array de {cod_dep, cod_mun})
     */
    SET NOCOUNT ON;

    SELECT 
        p.id AS product_id,
        p.product_name,
        p.contract_duration,
        p.duration_unit,
        p.amount_cop,
        p.enable,
        (
            SELECT 
                uz.cod_dep,
                uz.cod_mun,
                uz.enable
            FROM dbo.User_Zones uz
            WHERE uz.product_id = p.id
              AND uz.enable = 1
            FOR JSON PATH
        ) AS zones
    FROM dbo.Products p
    WHERE p.user_id = @user_id
      AND p.enable = 1
    ORDER BY p.id DESC;
END;
GO

PRINT '[03] Creado procedimiento GetUserProductsWithZones';
GO

-- ============================================================================
-- PASO 6: Crear SP para guardar/actualizar productos + zonas (UPSERT)
-- ============================================================================

CREATE OR ALTER PROCEDURE dbo.UpsertUserProducts
    @user_id       NVARCHAR(64),
    @products_json NVARCHAR(MAX)
AS
BEGIN
    /**
     * UPSERT de productos para un usuario. Recibe JSON array:
     * [
     *   {
     *     "id": 49,  (opcional; si ausente, INSERT nuevo)
     *     "name": "Votometro",
     *     "contract_duration": 1,
     *     "duration_unit": "years",
     *     "amount_cop": 150000,
     *     "enable": true,
     *     "zones": [
     *       {"cod_dep": "05", "cod_mun": null},
     *       {"cod_dep": "81", "cod_mun": "001"}
     *     ]
     *   },
     *   ...
     * ]
     *
     * LÃ³gica:
     * 1. MERGE en Products: UPDATE si existe ID, INSERT si no
     * 2. Recuperar product_id (IDENTITY)
     * 3. DELETE zonas antiguas de ese product_id
     * 4. INSERT zonas nuevas
     */

    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRAN;

    -- Tabla temporal para parsear JSON
    DECLARE @Products TABLE (
        rn              INT,
        product_id      INT,
        product_name    NVARCHAR(100),
        contract_duration INT,
        duration_unit   NVARCHAR(20),
        amount_cop      DECIMAL(18, 2),
        enable          BIT,
        zones_json      NVARCHAR(MAX)
    );

    -- Parsear el JSON array de productos
    INSERT INTO @Products (rn, product_id, product_name, contract_duration, 
                           duration_unit, amount_cop, enable, zones_json)
    SELECT 
        ROW_NUMBER() OVER (ORDER BY (SELECT NULL)),
        JSON_VALUE(p.value, '$.id'),
        JSON_VALUE(p.value, '$.name'),
        JSON_VALUE(p.value, '$.contract_duration'),
        JSON_VALUE(p.value, '$.duration_unit'),
        JSON_VALUE(p.value, '$.amount_cop'),
        CAST(JSON_VALUE(p.value, '$.enable') AS BIT),
        JSON_QUERY(p.value, '$.zones')
    FROM OPENJSON(@products_json) AS p;

    -- MERGE: Actualizar o insertar products
    MERGE INTO dbo.Products AS target
    USING (
        SELECT 
            product_id,
            @user_id AS user_id,
            product_name,
            contract_duration,
            duration_unit,
            amount_cop,
            enable
        FROM @Products
    ) AS source
    ON target.id = source.product_id AND target.user_id = source.user_id
    WHEN MATCHED THEN
        UPDATE SET
            product_name = source.product_name,
            contract_duration = source.contract_duration,
            duration_unit = source.duration_unit,
            amount_cop = source.amount_cop,
            enable = source.enable
    WHEN NOT MATCHED THEN
        INSERT (user_id, product_name, contract_duration, duration_unit, 
                amount_cop, enable)
        VALUES (source.user_id, source.product_name, source.contract_duration,
                source.duration_unit, source.amount_cop, source.enable);

    -- Para cada producto, procesar sus zonas
    DECLARE @idx INT = 1;
    DECLARE @max INT = (SELECT COUNT(*) FROM @Products);

    WHILE @idx <= @max
    BEGIN
        DECLARE @current_product_id INT;
        DECLARE @current_zones_json NVARCHAR(MAX);

        -- Recuperar el product_id (puede ser nuevo del INSERT)
        SELECT TOP 1 @current_product_id = COALESCE(product_id, p.id),
                     @current_zones_json = zones_json
        FROM @Products prod
        CROSS APPLY (
            SELECT TOP 1 id FROM dbo.Products p
            WHERE p.user_id = @user_id
              AND p.product_name = prod.product_name
            ORDER BY p.id DESC
        ) p
        WHERE prod.rn = @idx;

        -- Eliminar zonas antiguas del producto
        DELETE FROM dbo.User_Zones
        WHERE product_id = @current_product_id;

        -- Insertar zonas nuevas
        IF @current_zones_json IS NOT NULL
        BEGIN
            INSERT INTO dbo.User_Zones (user_id, product_id, cod_dep, cod_mun, enable)
            SELECT 
                @user_id,
                @current_product_id,
                JSON_VALUE(z.value, '$.cod_dep'),
                RIGHT(NULLIF(JSON_VALUE(z.value, '$.cod_mun'), ''), 3),
                1
            FROM OPENJSON(@current_zones_json) AS z;
        END;

        SET @idx = @idx + 1;
    END;

    COMMIT;
    PRINT '[UpsertUserProducts] OperaciÃ³n completada exitosamente.';
END;
GO

PRINT '[03] Creado procedimiento UpsertUserProducts';
GO

COMMIT;
GO

PRINT '[03_refactor_products_zones] RefactorizaciÃ³n completada.';
GO




