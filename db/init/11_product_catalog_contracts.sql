-- =====================================================================
-- 11_product_catalog_contracts.sql
-- Split product catalog from user contracts and remap User_Zones.
-- =====================================================================

USE [sqldb-ingenial-ia];
GO

SET XACT_ABORT ON;
SET NOCOUNT ON;
GO

BEGIN TRY
    BEGIN TRAN;

    IF OBJECT_ID('dbo.Products', 'U') IS NOT NULL
       AND COL_LENGTH('dbo.Products', 'user_id') IS NOT NULL
    BEGIN
        IF OBJECT_ID('dbo.Products_Legacy_Contracts', 'U') IS NULL
        BEGIN
            SELECT *
            INTO dbo.Products_Legacy_Contracts
            FROM dbo.Products;
        END;

        IF OBJECT_ID('dbo.Products_Catalog_New', 'U') IS NOT NULL
            DROP TABLE dbo.Products_Catalog_New;

        CREATE TABLE dbo.Products_Catalog_New (
            id   INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
            name NVARCHAR(100) NOT NULL
        );

        CREATE UNIQUE INDEX UQ_Products_Catalog_New_Name
            ON dbo.Products_Catalog_New(name);

        SET IDENTITY_INSERT dbo.Products_Catalog_New ON;
        INSERT INTO dbo.Products_Catalog_New (id, name)
        SELECT 1, N'Votometro'
        WHERE NOT EXISTS (SELECT 1 FROM dbo.Products_Catalog_New WHERE name = N'Votometro');

        INSERT INTO dbo.Products_Catalog_New (id, name)
        SELECT 2, N'Audivoto'
        WHERE NOT EXISTS (SELECT 1 FROM dbo.Products_Catalog_New WHERE name = N'Audivoto');
        SET IDENTITY_INSERT dbo.Products_Catalog_New OFF;

        INSERT INTO dbo.Products_Catalog_New (name)
        SELECT DISTINCT NULLIF(LTRIM(RTRIM(product_name)), '')
        FROM dbo.Products
        WHERE NULLIF(LTRIM(RTRIM(product_name)), '') IS NOT NULL
          AND NOT EXISTS (
              SELECT 1
              FROM dbo.Products_Catalog_New pc
              WHERE pc.name = NULLIF(LTRIM(RTRIM(dbo.Products.product_name)), '')
          );

        IF OBJECT_ID('dbo.User_Products', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.User_Products (
                id                INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                user_id           NVARCHAR(100) NOT NULL,
                product_id        INT NOT NULL,
                contract_duration INT NULL,
                duration_unit     NVARCHAR(20) NULL,
                expiration        DATETIME NULL,
                amount_cop        DECIMAL(10, 2) NULL,
                enable            BIT NOT NULL CONSTRAINT DF_UserProducts_enable DEFAULT 1,
                created_at        DATETIME2(0) NOT NULL CONSTRAINT DF_UserProducts_created DEFAULT SYSUTCDATETIME(),
                updated_at        DATETIME2(0) NULL
            );
        END;

        DECLARE @ProductMap TABLE (
            old_product_id INT NOT NULL PRIMARY KEY,
            user_product_id INT NOT NULL
        );

        MERGE dbo.User_Products AS target
        USING (
            SELECT
                p.id AS old_product_id,
                p.user_id,
                pc.id AS product_id,
                p.contract_duration,
                p.duration_unit,
                p.expiration,
                p.amount_cop,
                COALESCE(p.enable, 1) AS enable
            FROM dbo.Products p
            INNER JOIN dbo.Products_Catalog_New pc
                ON pc.name = p.product_name
            WHERE p.user_id IS NOT NULL
              AND p.product_name IS NOT NULL
        ) AS source
        ON target.user_id = source.user_id
           AND target.product_id = source.product_id
        WHEN MATCHED THEN
            UPDATE SET
                contract_duration = source.contract_duration,
                duration_unit = source.duration_unit,
                expiration = source.expiration,
                amount_cop = source.amount_cop,
                enable = source.enable,
                updated_at = SYSUTCDATETIME()
        WHEN NOT MATCHED THEN
            INSERT (
                user_id,
                product_id,
                contract_duration,
                duration_unit,
                expiration,
                amount_cop,
                enable,
                updated_at
            )
            VALUES (
                source.user_id,
                source.product_id,
                source.contract_duration,
                source.duration_unit,
                source.expiration,
                source.amount_cop,
                source.enable,
                SYSUTCDATETIME()
            )
        ;

        INSERT INTO @ProductMap(old_product_id, user_product_id)
        SELECT p.id, up.id
        FROM dbo.Products p
        INNER JOIN dbo.Products_Catalog_New pc
            ON pc.name = p.product_name
        INNER JOIN dbo.User_Products up
            ON up.user_id = p.user_id
           AND up.product_id = pc.id
        WHERE p.user_id IS NOT NULL
          AND p.product_name IS NOT NULL;

        IF OBJECT_ID('dbo.User_Zones', 'U') IS NOT NULL
           AND COL_LENGTH('dbo.User_Zones', 'user_product_id') IS NULL
        BEGIN
            ALTER TABLE dbo.User_Zones ADD user_product_id INT NULL;
        END;

        IF OBJECT_ID('dbo.User_Zones', 'U') IS NOT NULL
        BEGIN
            SELECT old_product_id, user_product_id
            INTO #ProductMap
            FROM @ProductMap;

            EXEC sp_executesql N'
                UPDATE uz
                   SET user_product_id = pm.user_product_id
                FROM dbo.User_Zones uz
                INNER JOIN #ProductMap pm
                    ON pm.old_product_id = uz.product_id
                WHERE uz.user_product_id IS NULL;
            ';

            DROP TABLE #ProductMap;
        END;

        DECLARE @dropFk NVARCHAR(MAX) = N'';
        SELECT @dropFk = @dropFk + N'ALTER TABLE '
            + QUOTENAME(OBJECT_SCHEMA_NAME(fk.parent_object_id)) + N'.'
            + QUOTENAME(OBJECT_NAME(fk.parent_object_id))
            + N' DROP CONSTRAINT ' + QUOTENAME(fk.name) + N';'
            + CHAR(13)
        FROM sys.foreign_keys fk
        WHERE fk.referenced_object_id = OBJECT_ID(N'dbo.Products')
           OR fk.parent_object_id = OBJECT_ID(N'dbo.Products');
        IF @dropFk <> N'' EXEC sp_executesql @dropFk;

        DROP TABLE dbo.Products;
        EXEC sp_rename 'dbo.Products_Catalog_New', 'Products';
    END
    ELSE
    BEGIN
        IF OBJECT_ID('dbo.Products', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.Products (
                id   INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                name NVARCHAR(100) NOT NULL
            );
        END;

        IF COL_LENGTH('dbo.Products', 'name') IS NULL
        BEGIN
            ALTER TABLE dbo.Products ADD name NVARCHAR(100) NULL;
        END;
    END;

    EXEC sp_executesql N'
        IF NOT EXISTS (SELECT 1 FROM dbo.Products WHERE name = N''Votometro'')
            INSERT INTO dbo.Products (name) VALUES (N''Votometro'');
        IF NOT EXISTS (SELECT 1 FROM dbo.Products WHERE name = N''Audivoto'')
            INSERT INTO dbo.Products (name) VALUES (N''Audivoto'');

        UPDATE dbo.Products
           SET name = CONCAT(N''Producto '', id)
         WHERE name IS NULL;
    ';

    IF EXISTS (
        SELECT 1
        FROM sys.columns
        WHERE object_id = OBJECT_ID(N'dbo.Products')
          AND name = N'name'
          AND is_nullable = 1
    )
    BEGIN
        ALTER TABLE dbo.Products ALTER COLUMN name NVARCHAR(100) NOT NULL;
    END;

    DECLARE @dropProductDefaults NVARCHAR(MAX) = N'';
    SELECT @dropProductDefaults = @dropProductDefaults
        + N'ALTER TABLE dbo.Products DROP CONSTRAINT '
        + QUOTENAME(dc.name) + N';' + CHAR(13)
    FROM sys.default_constraints dc
    INNER JOIN sys.columns c
        ON c.object_id = dc.parent_object_id
       AND c.column_id = dc.parent_column_id
    WHERE dc.parent_object_id = OBJECT_ID(N'dbo.Products')
      AND c.name NOT IN (N'id', N'name');
    IF @dropProductDefaults <> N'' EXEC sp_executesql @dropProductDefaults;

    DECLARE @dropProductIndexes NVARCHAR(MAX) = N'';
    SELECT @dropProductIndexes = @dropProductIndexes
        + N'DROP INDEX ' + QUOTENAME(i.name)
        + N' ON dbo.Products;' + CHAR(13)
    FROM sys.indexes i
    WHERE i.object_id = OBJECT_ID(N'dbo.Products')
      AND i.is_primary_key = 0
      AND EXISTS (
          SELECT 1
          FROM sys.index_columns ic
          INNER JOIN sys.columns c
              ON c.object_id = ic.object_id
             AND c.column_id = ic.column_id
          WHERE ic.object_id = i.object_id
            AND ic.index_id = i.index_id
            AND c.name NOT IN (N'id', N'name')
      );
    IF @dropProductIndexes <> N'' EXEC sp_executesql @dropProductIndexes;

    DECLARE @dropProductColumns NVARCHAR(MAX) = N'';
    SELECT @dropProductColumns = @dropProductColumns
        + N'ALTER TABLE dbo.Products DROP COLUMN '
        + QUOTENAME(c.name) + N';' + CHAR(13)
    FROM sys.columns c
    WHERE c.object_id = OBJECT_ID(N'dbo.Products')
      AND c.name NOT IN (N'id', N'name');
    IF @dropProductColumns <> N'' EXEC sp_executesql @dropProductColumns;

    IF NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE name = N'UQ_Products_Name'
          AND object_id = OBJECT_ID(N'dbo.Products')
    )
    BEGIN
        EXEC sp_executesql N'CREATE UNIQUE INDEX UQ_Products_Name ON dbo.Products(name);';
    END;

    IF OBJECT_ID('dbo.User_Products', 'U') IS NULL
    BEGIN
        CREATE TABLE dbo.User_Products (
            id                INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
            user_id           NVARCHAR(100) NOT NULL,
            product_id        INT NOT NULL,
            contract_duration INT NULL,
            duration_unit     NVARCHAR(20) NULL,
            expiration        DATETIME NULL,
            amount_cop        DECIMAL(10, 2) NULL,
            enable            BIT NOT NULL CONSTRAINT DF_UserProducts_enable DEFAULT 1,
            created_at        DATETIME2(0) NOT NULL CONSTRAINT DF_UserProducts_created DEFAULT SYSUTCDATETIME(),
            updated_at        DATETIME2(0) NULL
        );
    END;

    IF COL_LENGTH('dbo.User_Products', 'contract_duration') IS NULL
        ALTER TABLE dbo.User_Products ADD contract_duration INT NULL;
    IF COL_LENGTH('dbo.User_Products', 'duration_unit') IS NULL
        ALTER TABLE dbo.User_Products ADD duration_unit NVARCHAR(20) NULL;
    IF COL_LENGTH('dbo.User_Products', 'expiration') IS NULL
        ALTER TABLE dbo.User_Products ADD expiration DATETIME NULL;
    IF COL_LENGTH('dbo.User_Products', 'amount_cop') IS NULL
        ALTER TABLE dbo.User_Products ADD amount_cop DECIMAL(10,2) NULL;
    IF COL_LENGTH('dbo.User_Products', 'enable') IS NULL
        ALTER TABLE dbo.User_Products ADD enable BIT NOT NULL CONSTRAINT DF_UserProducts_enable_late DEFAULT 1;
    IF COL_LENGTH('dbo.User_Products', 'updated_at') IS NULL
        ALTER TABLE dbo.User_Products ADD updated_at DATETIME2(0) NULL;

    IF NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE name = N'UQ_UserProducts_User_Product'
          AND object_id = OBJECT_ID(N'dbo.User_Products')
    )
    BEGIN
        CREATE UNIQUE INDEX UQ_UserProducts_User_Product
            ON dbo.User_Products(user_id, product_id);
    END;

    IF NOT EXISTS (
        SELECT 1 FROM sys.foreign_keys
        WHERE name = N'FK_UserProducts_Users'
    )
    BEGIN
        ALTER TABLE dbo.User_Products
        ADD CONSTRAINT FK_UserProducts_Users
            FOREIGN KEY (user_id) REFERENCES dbo.Users(user_id)
            ON DELETE CASCADE;
    END;

    IF NOT EXISTS (
        SELECT 1 FROM sys.foreign_keys
        WHERE name = N'FK_UserProducts_Products'
    )
    BEGIN
        ALTER TABLE dbo.User_Products
        ADD CONSTRAINT FK_UserProducts_Products
            FOREIGN KEY (product_id) REFERENCES dbo.Products(id);
    END;

    IF OBJECT_ID('dbo.User_Zones', 'U') IS NOT NULL
    BEGIN
        DECLARE @dropLegacyUzFk NVARCHAR(MAX) = N'';
        SELECT @dropLegacyUzFk = @dropLegacyUzFk + N'ALTER TABLE dbo.User_Zones DROP CONSTRAINT '
            + QUOTENAME(fk.name) + N';' + CHAR(13)
        FROM sys.foreign_keys fk
        WHERE fk.parent_object_id = OBJECT_ID(N'dbo.User_Zones')
          AND fk.referenced_object_id = OBJECT_ID(N'dbo.Products');
        IF @dropLegacyUzFk <> N'' EXEC sp_executesql @dropLegacyUzFk;

        IF COL_LENGTH('dbo.User_Zones', 'user_product_id') IS NULL
            ALTER TABLE dbo.User_Zones ADD user_product_id INT NULL;

        IF COL_LENGTH('dbo.User_Zones', 'product_id') IS NOT NULL
        BEGIN
            ALTER TABLE dbo.User_Zones ALTER COLUMN product_id INT NULL;
        END;

        IF COL_LENGTH('dbo.User_Zones', 'user_id') IS NOT NULL
           AND EXISTS (
                SELECT 1
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = 'dbo'
                  AND TABLE_NAME = 'User_Zones'
                  AND COLUMN_NAME = 'user_id'
                  AND IS_NULLABLE = 'NO'
           )
        BEGIN
            ALTER TABLE dbo.User_Zones ALTER COLUMN user_id NVARCHAR(64) NULL;
        END;

        IF NOT EXISTS (
            SELECT 1 FROM sys.indexes
            WHERE name = N'IX_UZ_user_product'
              AND object_id = OBJECT_ID(N'dbo.User_Zones')
        )
        BEGIN
            EXEC sp_executesql N'
                CREATE INDEX IX_UZ_user_product
                    ON dbo.User_Zones(user_product_id)
                    INCLUDE (cod_dep, cod_mun, enable);
            ';
        END;

        IF NOT EXISTS (
            SELECT 1 FROM sys.foreign_keys
            WHERE name = N'FK_UZ_UserProduct'
        )
        BEGIN
            EXEC sp_executesql N'
                ALTER TABLE dbo.User_Zones
                ADD CONSTRAINT FK_UZ_UserProduct
                    FOREIGN KEY (user_product_id)
                    REFERENCES dbo.User_Products(id)
                    ON DELETE CASCADE;
            ';
        END;
    END;

    COMMIT;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
END CATCH;
GO

CREATE OR ALTER VIEW dbo.V_UserProducts_With_Zones AS
SELECT
    up.id AS user_product_id,
    up.user_id,
    p.id AS product_id,
    p.name AS product_name,
    up.contract_duration,
    up.duration_unit,
    up.expiration,
    up.amount_cop,
    up.enable AS product_enabled,
    uz.id AS zone_id,
    uz.cod_dep,
    uz.cod_mun,
    uz.enable AS zone_enabled,
    uz.created_at AS zone_created_at
FROM dbo.User_Products up
INNER JOIN dbo.Products p ON p.id = up.product_id
LEFT JOIN dbo.User_Zones uz ON uz.user_product_id = up.id;
GO

CREATE OR ALTER PROCEDURE dbo.GetUserProductsWithZones
    @user_id NVARCHAR(100)
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE dbo.User_Products
    SET enable = 0,
        updated_at = SYSUTCDATETIME()
    WHERE enable = 1
      AND expiration IS NOT NULL
      AND expiration <= SYSUTCDATETIME();

    SELECT
        up.id AS product_id,
        p.name AS product_name,
        up.contract_duration,
        up.duration_unit,
        up.expiration,
        up.amount_cop,
        up.enable,
        (
            SELECT uz.cod_dep, uz.cod_mun, uz.enable
            FROM dbo.User_Zones uz
            WHERE uz.user_product_id = up.id
              AND uz.enable = 1
            ORDER BY uz.cod_dep, uz.cod_mun
            FOR JSON PATH
        ) AS zones
    FROM dbo.User_Products up
    INNER JOIN dbo.Products p ON p.id = up.product_id
    WHERE up.user_id = @user_id
      AND up.enable = 1
      AND (up.expiration IS NULL OR up.expiration > SYSUTCDATETIME())
    ORDER BY up.id DESC;
END;
GO

CREATE OR ALTER PROCEDURE dbo.GetUserZonesForProduct
    @product_id INT
AS
BEGIN
    SET NOCOUNT ON;

    SELECT uz.cod_dep, uz.cod_mun
    FROM dbo.User_Zones uz
    WHERE uz.user_product_id = @product_id
      AND uz.enable = 1
    ORDER BY uz.cod_dep, uz.cod_mun;
END;
GO

CREATE OR ALTER PROCEDURE dbo.GetUserZones
    @user_id NVARCHAR(100)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT uz.cod_dep, uz.cod_mun
    FROM dbo.User_Zones uz
    LEFT JOIN dbo.User_Products up ON up.id = uz.user_product_id
    WHERE (uz.user_id = @user_id OR up.user_id = @user_id)
      AND uz.enable = 1
    ORDER BY uz.cod_dep, uz.cod_mun;
END;
GO

CREATE OR ALTER PROCEDURE dbo.UpsertUserZonesForProduct
    @product_id INT,
    @assignments NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @UserId NVARCHAR(100);
    SELECT @UserId = user_id
    FROM dbo.User_Products
    WHERE id = @product_id;

    IF @UserId IS NULL
        THROW 51000, 'User_Products row not found', 1;

    BEGIN TRAN;

    DELETE FROM dbo.User_Zones WHERE user_product_id = @product_id;

    INSERT INTO dbo.User_Zones (user_id, user_product_id, cod_dep, cod_mun, enable)
    SELECT
        @UserId,
        @product_id,
        RIGHT('00' + JSON_VALUE(j.value, '$.cod_dep'), 2),
        CASE
            WHEN NULLIF(JSON_VALUE(j.value, '$.cod_mun'), '') IS NULL THEN NULL
            ELSE RIGHT('000' + JSON_VALUE(j.value, '$.cod_mun'), 3)
        END,
        COALESCE(TRY_CONVERT(BIT, JSON_VALUE(j.value, '$.enable')), 1)
    FROM OPENJSON(@assignments) AS j;

    COMMIT;
END;
GO

CREATE OR ALTER PROCEDURE dbo.UpsertUserProducts
    @user_id NVARCHAR(100),
    @products_json NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRAN;

    DECLARE @incoming TABLE (
        name NVARCHAR(100) NOT NULL,
        contract_duration INT NULL,
        duration_unit NVARCHAR(20) NULL,
        expiration DATETIME NULL,
        amount_cop DECIMAL(10,2) NULL,
        enable BIT NOT NULL,
        zones NVARCHAR(MAX) NULL
    );

    INSERT INTO @incoming (
        name,
        contract_duration,
        duration_unit,
        expiration,
        amount_cop,
        enable,
        zones
    )
    SELECT
        JSON_VALUE(value, '$.name'),
        TRY_CONVERT(INT, JSON_VALUE(value, '$.contract_duration')),
        JSON_VALUE(value, '$.duration_unit'),
        TRY_CONVERT(DATETIME, JSON_VALUE(value, '$.expiration')),
        TRY_CONVERT(DECIMAL(10,2), JSON_VALUE(value, '$.amount_cop')),
        COALESCE(TRY_CONVERT(BIT, JSON_VALUE(value, '$.enable')), 1),
        JSON_QUERY(value, '$.zones')
    FROM OPENJSON(@products_json)
    WHERE JSON_VALUE(value, '$.name') IS NOT NULL;

    INSERT INTO dbo.Products (name)
    SELECT DISTINCT i.name
    FROM @incoming i
    WHERE NOT EXISTS (
        SELECT 1 FROM dbo.Products p WHERE p.name = i.name
    );

    MERGE dbo.User_Products AS target
    USING (
        SELECT
            @user_id AS user_id,
            p.id AS product_id,
            i.contract_duration,
            i.duration_unit,
            i.expiration,
            i.amount_cop,
            CASE
                WHEN i.expiration IS NOT NULL AND i.expiration <= SYSUTCDATETIME() THEN 0
                ELSE i.enable
            END AS enable
        FROM @incoming i
        INNER JOIN dbo.Products p ON p.name = i.name
    ) AS source
    ON target.user_id = source.user_id
       AND target.product_id = source.product_id
    WHEN MATCHED THEN
        UPDATE SET
            contract_duration = source.contract_duration,
            duration_unit = source.duration_unit,
            expiration = source.expiration,
            amount_cop = source.amount_cop,
            enable = source.enable,
            updated_at = SYSUTCDATETIME()
    WHEN NOT MATCHED THEN
        INSERT (
            user_id,
            product_id,
            contract_duration,
            duration_unit,
            expiration,
            amount_cop,
            enable,
            updated_at
        )
        VALUES (
            source.user_id,
            source.product_id,
            source.contract_duration,
            source.duration_unit,
            source.expiration,
            source.amount_cop,
            source.enable,
            SYSUTCDATETIME()
        );

    DELETE uz
    FROM dbo.User_Zones uz
    INNER JOIN dbo.User_Products up ON up.id = uz.user_product_id
    INNER JOIN dbo.Products p ON p.id = up.product_id
    INNER JOIN @incoming i ON i.name = p.name
    WHERE up.user_id = @user_id;

    INSERT INTO dbo.User_Zones (user_id, user_product_id, cod_dep, cod_mun, enable)
    SELECT
        @user_id,
        up.id,
        RIGHT('00' + JSON_VALUE(z.value, '$.cod_dep'), 2),
        CASE
            WHEN NULLIF(JSON_VALUE(z.value, '$.cod_mun'), '') IS NULL THEN NULL
            ELSE RIGHT('000' + JSON_VALUE(z.value, '$.cod_mun'), 3)
        END,
        COALESCE(TRY_CONVERT(BIT, JSON_VALUE(z.value, '$.enable')), 1)
    FROM @incoming i
    INNER JOIN dbo.Products p ON p.name = i.name
    INNER JOIN dbo.User_Products up
        ON up.user_id = @user_id
       AND up.product_id = p.id
    CROSS APPLY OPENJSON(COALESCE(i.zones, N'[]')) z;

    COMMIT;
END;
GO

PRINT '[11_product_catalog_contracts] Product catalog/User_Products migration complete.';
GO
