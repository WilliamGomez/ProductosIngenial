-- =====================================================================
-- 11_hard_reset_schema.sql
-- HARD RESET: Tercera Forma Normal — cero preservación de datos legacy.
--
-- Efecto:
--   · Elimina TODOS los usuarios excepto productos@ingenial-ia.com.
--   · Destruye y recrea dbo.Products (catálogo), dbo.User_Products
--     (contratos) y dbo.User_Zones (zonas por contrato).
--   · Recrea vista V_UserProducts_With_Zones y los SPs de lectura/escritura.
--
-- Ejecutar directamente en sqldb-ingenial-ia (no requiere parámetros).
-- =====================================================================

USE [sqldb-ingenial-ia];
GO

SET XACT_ABORT ON;
SET NOCOUNT ON;
GO

-- =====================================================================
-- PASO 1 — Eliminar FK que impiden DROP TABLE
--   Usamos SQL dinámico SOLO para descubrir nombres auto-generados;
--   no hay lógica de migración aquí.
-- =====================================================================
DECLARE @drop_fk NVARCHAR(MAX) = N'';

SELECT @drop_fk += N'ALTER TABLE '
    + QUOTENAME(OBJECT_SCHEMA_NAME(fk.parent_object_id))
    + N'.' + QUOTENAME(OBJECT_NAME(fk.parent_object_id))
    + N' DROP CONSTRAINT ' + QUOTENAME(fk.name) + N';' + CHAR(10)
FROM sys.foreign_keys AS fk
WHERE fk.referenced_object_id IN (
        OBJECT_ID(N'dbo.Products'),
        OBJECT_ID(N'dbo.User_Products')
      )
   OR fk.parent_object_id IN (
        OBJECT_ID(N'dbo.User_Zones'),
        OBJECT_ID(N'dbo.User_Products')
      );

IF @drop_fk <> N''
    EXEC sp_executesql @drop_fk;
GO

-- =====================================================================
-- PASO 2 — DROP tablas (orden: hijos antes que padres)
-- =====================================================================
DROP TABLE IF EXISTS dbo.User_Zones;
DROP TABLE IF EXISTS dbo.User_Products;
DROP TABLE IF EXISTS dbo.Products;

-- Limpiar residuos de migraciones anteriores (Codex / scripts legacy)
DROP TABLE IF EXISTS dbo.Products_Legacy_Contracts;
DROP TABLE IF EXISTS dbo.Products_Catalog_New;
GO

-- =====================================================================
-- PASO 3 — Purgar usuarios de prueba
--   Se hace DESPUÉS de DROP TABLE para evitar conflictos de CASCADE.
-- =====================================================================
DELETE FROM dbo.Users
WHERE email <> 'productos@ingenial-ia.com';
GO

-- =====================================================================
-- PASO 4 — Crear dbo.Products  (catálogo maestro, solo id + name)
-- =====================================================================
CREATE TABLE dbo.Products (
    id   INT           IDENTITY(1,1) NOT NULL
         CONSTRAINT PK_Products PRIMARY KEY,
    name NVARCHAR(100) NOT NULL
         CONSTRAINT UQ_Products_Name UNIQUE
);
GO

-- Catálogo base
INSERT INTO dbo.Products (name)
VALUES (N'Votometro'), (N'Audivoto');
GO

-- =====================================================================
-- PASO 5 — Crear dbo.User_Products  (contratos usuario ↔ producto)
-- =====================================================================
CREATE TABLE dbo.User_Products (
    id                INT           IDENTITY(1,1) NOT NULL
                      CONSTRAINT PK_UserProducts PRIMARY KEY,

    user_id           NVARCHAR(100) NOT NULL
                      CONSTRAINT FK_UserProducts_Users
                          FOREIGN KEY REFERENCES dbo.Users(user_id)
                          ON DELETE CASCADE,

    product_id        INT           NOT NULL
                      CONSTRAINT FK_UserProducts_Products
                          FOREIGN KEY REFERENCES dbo.Products(id),

    contract_duration INT           NULL,
    duration_unit     NVARCHAR(20)  NULL,
    expiration        DATETIME      NULL,
    amount_cop        DECIMAL(10,2) NULL,

    enable            BIT           NOT NULL
                      CONSTRAINT DF_UserProducts_enable DEFAULT 1,

    created_at        DATETIME2(0)  NOT NULL
                      CONSTRAINT DF_UserProducts_created DEFAULT SYSUTCDATETIME(),

    updated_at        DATETIME2(0)  NULL,

    CONSTRAINT UQ_UserProducts_User_Product UNIQUE (user_id, product_id)
);

CREATE INDEX IX_UserProducts_UserId
    ON dbo.User_Products(user_id)
    INCLUDE (product_id, enable);
GO

-- =====================================================================
-- PASO 6 — Crear dbo.User_Zones  (zonas geográficas por contrato)
--   · NO contiene user_id (3NF: se deriva via user_product_id).
--   · cod_dep VARCHAR(2)  — 2 dígitos DIVIPOLA (dep).
--   · cod_mun VARCHAR(3)  — 3 dígitos DIVIPOLA (mun); NULL = depto completo.
-- =====================================================================
CREATE TABLE dbo.User_Zones (
    id              INT          IDENTITY(1,1) NOT NULL
                    CONSTRAINT PK_UserZones PRIMARY KEY,

    user_product_id INT          NOT NULL
                    CONSTRAINT FK_UserZones_UserProducts
                        FOREIGN KEY REFERENCES dbo.User_Products(id)
                        ON DELETE CASCADE,

    cod_dep         VARCHAR(2)   NOT NULL,
    cod_mun         VARCHAR(3)   NULL,          -- NULL = departamento completo

    enable          BIT          NOT NULL
                    CONSTRAINT DF_UserZones_enable DEFAULT 1,

    created_at      DATETIME2(0) NOT NULL
                    CONSTRAINT DF_UserZones_created DEFAULT SYSUTCDATETIME(),

    updated_at      DATETIME2(0) NULL
);

CREATE INDEX IX_UserZones_UserProductId
    ON dbo.User_Zones(user_product_id)
    INCLUDE (cod_dep, cod_mun, enable);
GO

-- =====================================================================
-- PASO 7 — Vista: V_UserProducts_With_Zones
-- =====================================================================
CREATE OR ALTER VIEW dbo.V_UserProducts_With_Zones AS
SELECT
    up.id               AS user_product_id,
    up.user_id,
    p.id                AS product_id,
    p.name              AS product_name,
    up.contract_duration,
    up.duration_unit,
    up.expiration,
    up.amount_cop,
    up.enable           AS product_enabled,
    up.created_at       AS contract_created_at,
    uz.id               AS zone_id,
    uz.cod_dep,
    uz.cod_mun,
    uz.enable           AS zone_enabled
FROM      dbo.User_Products up
INNER JOIN dbo.Products      p  ON p.id  = up.product_id
LEFT  JOIN dbo.User_Zones    uz ON uz.user_product_id = up.id;
GO

-- =====================================================================
-- PASO 8 — SP: GetUserProductsWithZones
--   Devuelve productos activos con zonas anidadas en JSON.
--   El campo "product_id" en el resultado es el user_product_id
--   (la PK del contrato), que el frontend usa como id de producto.
-- =====================================================================
CREATE OR ALTER PROCEDURE dbo.GetUserProductsWithZones
    @user_id NVARCHAR(100)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        up.id               AS product_id,
        p.name              AS product_name,
        up.contract_duration,
        up.duration_unit,
        up.expiration,
        up.amount_cop,
        up.enable,
        (
            SELECT uz.cod_dep, uz.cod_mun, uz.enable
            FROM   dbo.User_Zones uz
            WHERE  uz.user_product_id = up.id
              AND  uz.enable = 1
            ORDER BY uz.cod_dep, uz.cod_mun
            FOR JSON PATH
        ) AS zones
    FROM       dbo.User_Products up
    INNER JOIN dbo.Products       p ON p.id = up.product_id
    WHERE up.user_id = @user_id
      AND up.enable  = 1
    ORDER BY up.id DESC;
END;
GO

-- =====================================================================
-- PASO 9 — SP: UpsertUserProducts
--   Recibe un JSON array de productos con zonas anidadas.
--
--   Payload de ejemplo:
--   [
--     {
--       "name": "Votometro",
--       "contract_duration": 12,
--       "duration_unit": "months",
--       "expiration": "2027-01-01T00:00:00",
--       "amount_cop": 150000,
--       "enable": 1,
--       "zones": [
--         { "cod_dep": "05", "cod_mun": null },
--         { "cod_dep": "11", "cod_mun": "001" }
--       ]
--     }
--   ]
--
--   Reglas de padding (equivalente a Python zfill):
--     cod_dep → RIGHT('00'  + valor, 2)
--     cod_mun → RIGHT('000' + valor, 3)   (solo si no es NULL/vacío)
-- =====================================================================
CREATE OR ALTER PROCEDURE dbo.UpsertUserProducts
    @user_id       NVARCHAR(100),
    @products_json NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRAN;

    -- Tabla temporal para los productos recibidos
    DECLARE @incoming TABLE (
        name              NVARCHAR(100) NOT NULL,
        contract_duration INT           NULL,
        duration_unit     NVARCHAR(20)  NULL,
        expiration        DATETIME      NULL,
        amount_cop        DECIMAL(10,2) NULL,
        enable            BIT           NOT NULL,
        zones             NVARCHAR(MAX) NULL
    );

    INSERT INTO @incoming (name, contract_duration, duration_unit,
                           expiration, amount_cop, enable, zones)
    SELECT
        JSON_VALUE(value, '$.name'),
        TRY_CONVERT(INT,          JSON_VALUE(value, '$.contract_duration')),
        JSON_VALUE(value,         '$.duration_unit'),
        TRY_CONVERT(DATETIME,     JSON_VALUE(value, '$.expiration')),
        TRY_CONVERT(DECIMAL(10,2),JSON_VALUE(value, '$.amount_cop')),
        COALESCE(TRY_CONVERT(BIT, JSON_VALUE(value, '$.enable')), 1),
        JSON_QUERY(value,         '$.zones')
    FROM OPENJSON(@products_json)
    WHERE JSON_VALUE(value, '$.name') IS NOT NULL;

    -- MERGE contratos: INSERT o UPDATE según (user_id, product_id)
    MERGE dbo.User_Products AS T
    USING (
        SELECT
            @user_id AS user_id,
            p.id     AS product_id,
            i.contract_duration,
            i.duration_unit,
            i.expiration,
            i.amount_cop,
            i.enable
        FROM @incoming i
        INNER JOIN dbo.Products p ON p.name = i.name
    ) AS S
    ON T.user_id = S.user_id AND T.product_id = S.product_id
    WHEN MATCHED THEN
        UPDATE SET
            contract_duration = S.contract_duration,
            duration_unit     = S.duration_unit,
            expiration        = S.expiration,
            amount_cop        = S.amount_cop,
            enable            = S.enable,
            updated_at        = SYSUTCDATETIME()
    WHEN NOT MATCHED THEN
        INSERT (user_id, product_id, contract_duration, duration_unit,
                expiration, amount_cop, enable, updated_at)
        VALUES (S.user_id, S.product_id, S.contract_duration, S.duration_unit,
                S.expiration, S.amount_cop, S.enable, SYSUTCDATETIME());

    -- Reemplazar zonas de cada producto recibido (DELETE + INSERT atómico)
    DELETE uz
    FROM       dbo.User_Zones    uz
    INNER JOIN dbo.User_Products up ON up.id  = uz.user_product_id
    INNER JOIN dbo.Products      p  ON p.id   = up.product_id
    INNER JOIN @incoming         i  ON i.name = p.name
    WHERE up.user_id = @user_id;

    INSERT INTO dbo.User_Zones (user_product_id, cod_dep, cod_mun, enable)
    SELECT
        up.id,
        -- zfill(2) para cod_dep
        RIGHT('00'  + JSON_VALUE(z.value, '$.cod_dep'), 2),
        -- zfill(3) para cod_mun; NULL si viene vacío/nulo
        CASE
            WHEN NULLIF(JSON_VALUE(z.value, '$.cod_mun'), '') IS NULL THEN NULL
            ELSE RIGHT('000' + JSON_VALUE(z.value, '$.cod_mun'), 3)
        END,
        COALESCE(TRY_CONVERT(BIT, JSON_VALUE(z.value, '$.enable')), 1)
    FROM @incoming i
    INNER JOIN dbo.Products      p  ON p.name    = i.name
    INNER JOIN dbo.User_Products up ON up.user_id = @user_id
                                   AND up.product_id = p.id
    CROSS APPLY OPENJSON(COALESCE(i.zones, N'[]')) AS z
    WHERE JSON_VALUE(z.value, '$.cod_dep') IS NOT NULL
      AND NULLIF(JSON_VALUE(z.value, '$.cod_dep'), '') IS NOT NULL;

    COMMIT;
END;
GO

-- =====================================================================
-- PASO 10 — SP: UpsertUserZonesForProduct
--   Reemplaza solo las zonas de UN contrato específico sin tocar el
--   resto del perfil del usuario.
--
--   @user_product_id  → dbo.User_Products.id  (PK del contrato)
--   @assignments      → JSON array de zonas:
--                        [{"cod_dep":"05"},{"cod_dep":"11","cod_mun":"001"}]
-- =====================================================================
CREATE OR ALTER PROCEDURE dbo.UpsertUserZonesForProduct
    @user_product_id INT,
    @assignments     NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (
        SELECT 1 FROM dbo.User_Products WHERE id = @user_product_id
    )
        THROW 51001, 'No existe el contrato user_product_id indicado.', 1;

    BEGIN TRAN;

    DELETE FROM dbo.User_Zones
    WHERE user_product_id = @user_product_id;

    INSERT INTO dbo.User_Zones (user_product_id, cod_dep, cod_mun, enable)
    SELECT
        @user_product_id,
        RIGHT('00'  + JSON_VALUE(j.value, '$.cod_dep'), 2),
        CASE
            WHEN NULLIF(JSON_VALUE(j.value, '$.cod_mun'), '') IS NULL THEN NULL
            ELSE RIGHT('000' + JSON_VALUE(j.value, '$.cod_mun'), 3)
        END,
        COALESCE(TRY_CONVERT(BIT, JSON_VALUE(j.value, '$.enable')), 1)
    FROM OPENJSON(@assignments) AS j
    WHERE JSON_VALUE(j.value, '$.cod_dep') IS NOT NULL
      AND NULLIF(JSON_VALUE(j.value, '$.cod_dep'), '') IS NOT NULL;

    COMMIT;
END;
GO

-- =====================================================================
-- PASO 11 — SP: GetUserZones  (lectura agregada para RLS / Power BI)
--   Devuelve las zonas efectivas del usuario cruzando TODOS sus contratos.
--   DIVIPOLA: NULL en cod_mun = depto completo → expande a sus municipios.
-- =====================================================================
CREATE OR ALTER PROCEDURE dbo.GetUserZones
    @user_id NVARCHAR(100)
AS
BEGIN
    SET NOCOUNT ON;

    ;WITH effective AS (
        -- Filas con municipio específico
        SELECT uz.cod_dep, uz.cod_mun
        FROM       dbo.User_Zones    uz
        INNER JOIN dbo.User_Products up ON up.id = uz.user_product_id
        WHERE up.user_id = @user_id
          AND up.enable  = 1
          AND uz.enable  = 1
          AND uz.cod_mun IS NOT NULL

        UNION

        -- Filas de depto completo → expandir a municipios via DIVIPOLA
        SELECT DISTINCT d.dep AS cod_dep, d.mun AS cod_mun
        FROM       dbo.User_Zones    uz
        INNER JOIN dbo.User_Products up ON up.id  = uz.user_product_id
        INNER JOIN dbo.DIVIPOLA       d  ON d.dep  = uz.cod_dep
        WHERE up.user_id = @user_id
          AND up.enable  = 1
          AND uz.enable  = 1
          AND uz.cod_mun IS NULL
    )
    SELECT cod_dep, cod_mun
    FROM   effective
    ORDER  BY cod_dep, cod_mun;
END;
GO

-- =====================================================================
-- PASO 12 — SP: GetUserZonesForProduct
--   Zonas efectivas de UN contrato específico (para Power BI embed).
-- =====================================================================
CREATE OR ALTER PROCEDURE dbo.GetUserZonesForProduct
    @user_product_id INT
AS
BEGIN
    SET NOCOUNT ON;

    ;WITH effective AS (
        SELECT uz.cod_dep, uz.cod_mun
        FROM dbo.User_Zones uz
        WHERE uz.user_product_id = @user_product_id
          AND uz.enable = 1
          AND uz.cod_mun IS NOT NULL

        UNION

        SELECT DISTINCT d.dep AS cod_dep, d.mun AS cod_mun
        FROM       dbo.User_Zones uz
        INNER JOIN dbo.DIVIPOLA    d ON d.dep = uz.cod_dep
        WHERE uz.user_product_id = @user_product_id
          AND uz.enable = 1
          AND uz.cod_mun IS NULL
    )
    SELECT cod_dep, cod_mun
    FROM   effective
    ORDER  BY cod_dep, cod_mun;
END;
GO

PRINT '[11_hard_reset_schema] Hard reset completo. Schema 3NF listo.';
GO
