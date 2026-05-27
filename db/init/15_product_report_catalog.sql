SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

/*
    15_product_report_catalog.sql
    Extiende dbo.Products como catalogo administrable de informes Power BI.

    Seguridad:
      - No almacena access tokens, embed tokens ni client secrets.
      - Solo guarda metadata necesaria para resolver el informe.
      - Los tokens se siguen generando en backend por solicitud.
*/

IF COL_LENGTH('dbo.Products', 'display_name') IS NULL
    ALTER TABLE dbo.Products ADD display_name NVARCHAR(120) NULL;

IF COL_LENGTH('dbo.Products', 'route_path') IS NULL
    ALTER TABLE dbo.Products ADD route_path NVARCHAR(120) NULL;

IF COL_LENGTH('dbo.Products', 'powerbi_report_id') IS NULL
    ALTER TABLE dbo.Products ADD powerbi_report_id UNIQUEIDENTIFIER NULL;

IF COL_LENGTH('dbo.Products', 'powerbi_workspace_id') IS NULL
    ALTER TABLE dbo.Products ADD powerbi_workspace_id UNIQUEIDENTIFIER NULL;

IF COL_LENGTH('dbo.Products', 'powerbi_tenant_id') IS NULL
    ALTER TABLE dbo.Products ADD powerbi_tenant_id UNIQUEIDENTIFIER NULL;

IF COL_LENGTH('dbo.Products', 'icon') IS NULL
    ALTER TABLE dbo.Products ADD icon NVARCHAR(50) NULL;

IF COL_LENGTH('dbo.Products', 'display_order') IS NULL
    ALTER TABLE dbo.Products ADD display_order INT NOT NULL
        CONSTRAINT DF_Products_DisplayOrder DEFAULT (100);

IF COL_LENGTH('dbo.Products', 'is_report_enabled') IS NULL
    ALTER TABLE dbo.Products ADD is_report_enabled BIT NOT NULL
        CONSTRAINT DF_Products_ReportEnabled DEFAULT (1);

IF COL_LENGTH('dbo.Products', 'description') IS NULL
    ALTER TABLE dbo.Products ADD description NVARCHAR(500) NULL;

IF COL_LENGTH('dbo.Products', 'created_at') IS NULL
    ALTER TABLE dbo.Products ADD created_at DATETIME2(0) NOT NULL
        CONSTRAINT DF_Products_CreatedAt DEFAULT SYSUTCDATETIME();

IF COL_LENGTH('dbo.Products', 'updated_at') IS NULL
    ALTER TABLE dbo.Products ADD updated_at DATETIME2(0) NULL;
GO

UPDATE dbo.Products
SET display_name = COALESCE(display_name, name),
    route_path = COALESCE(route_path, CONCAT(N'/', LOWER(name))),
    icon = COALESCE(icon, N'BarChart3'),
    display_order = COALESCE(display_order, 100),
    is_report_enabled = COALESCE(is_report_enabled, 1),
    updated_at = SYSUTCDATETIME()
WHERE display_name IS NULL
   OR route_path IS NULL
   OR icon IS NULL;
GO

UPDATE dbo.Products
SET display_name = N'Votometro',
    route_path = N'/votometro',
    powerbi_report_id = TRY_CONVERT(UNIQUEIDENTIFIER, N'9db4c8ee-d117-4a2e-9a72-9284c6208fa0'),
    icon = N'Archive',
    display_order = 10,
    is_report_enabled = 1,
    updated_at = SYSUTCDATETIME()
WHERE name = N'Votometro';

UPDATE dbo.Products
SET display_name = N'Audivoto',
    route_path = N'/audivoto',
    powerbi_report_id = TRY_CONVERT(UNIQUEIDENTIFIER, N'f88c2708-aa49-449a-974a-8e7f7ee972fb'),
    icon = N'Binoculars',
    display_order = 20,
    is_report_enabled = 1,
    updated_at = SYSUTCDATETIME()
WHERE name = N'Audivoto';
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = N'UX_Products_RoutePath'
      AND object_id = OBJECT_ID(N'dbo.Products')
)
BEGIN
    CREATE UNIQUE INDEX UX_Products_RoutePath
        ON dbo.Products(route_path)
        WHERE route_path IS NOT NULL;
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = N'UX_Products_PowerBIReportId'
      AND object_id = OBJECT_ID(N'dbo.Products')
)
BEGIN
    CREATE UNIQUE INDEX UX_Products_PowerBIReportId
        ON dbo.Products(powerbi_report_id)
        WHERE powerbi_report_id IS NOT NULL;
END;
GO

CREATE OR ALTER VIEW dbo.V_Product_Report_Catalog AS
SELECT
    id,
    name,
    display_name,
    route_path,
    CONVERT(NVARCHAR(36), powerbi_report_id) AS powerbi_report_id,
    CONVERT(NVARCHAR(36), powerbi_workspace_id) AS powerbi_workspace_id,
    CONVERT(NVARCHAR(36), powerbi_tenant_id) AS powerbi_tenant_id,
    icon,
    display_order,
    is_report_enabled,
    description,
    created_at,
    updated_at
FROM dbo.Products;
GO

CREATE OR ALTER PROCEDURE dbo.GetProductReportCatalog
    @include_disabled BIT = 0
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        id,
        name,
        display_name,
        route_path,
        powerbi_report_id,
        powerbi_workspace_id,
        powerbi_tenant_id,
        icon,
        display_order,
        is_report_enabled,
        description,
        created_at,
        updated_at
    FROM dbo.V_Product_Report_Catalog
    WHERE @include_disabled = 1
       OR is_report_enabled = 1
    ORDER BY display_order, display_name, name;
END;
GO

CREATE OR ALTER PROCEDURE dbo.GetProductReportByReportId
    @report_id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    SELECT TOP (1)
        id,
        name,
        display_name,
        route_path,
        powerbi_report_id,
        powerbi_workspace_id,
        powerbi_tenant_id,
        icon,
        display_order,
        is_report_enabled,
        description,
        created_at,
        updated_at
    FROM dbo.V_Product_Report_Catalog
    WHERE powerbi_report_id = @report_id;
END;
GO

CREATE OR ALTER PROCEDURE dbo.UpsertProductReportCatalog
    @product_id INT = NULL,
    @name NVARCHAR(100),
    @display_name NVARCHAR(120),
    @route_path NVARCHAR(120),
    @powerbi_report_id UNIQUEIDENTIFIER,
    @powerbi_workspace_id UNIQUEIDENTIFIER = NULL,
    @powerbi_tenant_id UNIQUEIDENTIFIER = NULL,
    @icon NVARCHAR(50) = NULL,
    @display_order INT = 100,
    @is_report_enabled BIT = 1,
    @description NVARCHAR(500) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    SET @name = NULLIF(LTRIM(RTRIM(@name)), N'');
    SET @display_name = NULLIF(LTRIM(RTRIM(@display_name)), N'');
    SET @route_path = LOWER(NULLIF(LTRIM(RTRIM(@route_path)), N''));
    SET @icon = NULLIF(LTRIM(RTRIM(@icon)), N'');

    IF @name IS NULL
        THROW 51000, 'name is required', 1;

    IF @display_name IS NULL
        SET @display_name = @name;

    IF @route_path IS NULL OR LEFT(@route_path, 1) <> N'/'
        THROW 51001, 'route_path must start with /', 1;

    IF @powerbi_report_id IS NULL
        THROW 51002, 'powerbi_report_id is required', 1;

    DECLARE @Changed TABLE (id INT NOT NULL);

    MERGE dbo.Products AS target
    USING (
        SELECT
            @product_id AS id,
            @name AS name,
            @display_name AS display_name,
            @route_path AS route_path,
            @powerbi_report_id AS powerbi_report_id,
            @powerbi_workspace_id AS powerbi_workspace_id,
            @powerbi_tenant_id AS powerbi_tenant_id,
            COALESCE(@icon, N'BarChart3') AS icon,
            COALESCE(@display_order, 100) AS display_order,
            COALESCE(@is_report_enabled, 1) AS is_report_enabled,
            @description AS description
    ) AS source
    ON target.id = source.id OR (@product_id IS NULL AND target.name = source.name)
    WHEN MATCHED THEN
        UPDATE SET
            name = source.name,
            display_name = source.display_name,
            route_path = source.route_path,
            powerbi_report_id = source.powerbi_report_id,
            powerbi_workspace_id = source.powerbi_workspace_id,
            powerbi_tenant_id = source.powerbi_tenant_id,
            icon = source.icon,
            display_order = source.display_order,
            is_report_enabled = source.is_report_enabled,
            description = source.description,
            updated_at = SYSUTCDATETIME()
    WHEN NOT MATCHED THEN
        INSERT (
            name,
            display_name,
            route_path,
            powerbi_report_id,
            powerbi_workspace_id,
            powerbi_tenant_id,
            icon,
            display_order,
            is_report_enabled,
            description,
            created_at,
            updated_at
        )
        VALUES (
            source.name,
            source.display_name,
            source.route_path,
            source.powerbi_report_id,
            source.powerbi_workspace_id,
            source.powerbi_tenant_id,
            source.icon,
            source.display_order,
            source.is_report_enabled,
            source.description,
            SYSUTCDATETIME(),
            SYSUTCDATETIME()
        )
    OUTPUT inserted.id INTO @Changed;

    DECLARE @resolved_id INT = (SELECT TOP (1) id FROM @Changed);
    IF @resolved_id IS NULL
        SELECT @resolved_id = id FROM dbo.Products WHERE name = @name;

    SELECT
        id,
        name,
        display_name,
        route_path,
        CONVERT(NVARCHAR(36), powerbi_report_id) AS powerbi_report_id,
        CONVERT(NVARCHAR(36), powerbi_workspace_id) AS powerbi_workspace_id,
        CONVERT(NVARCHAR(36), powerbi_tenant_id) AS powerbi_tenant_id,
        icon,
        display_order,
        is_report_enabled,
        description,
        created_at,
        updated_at
    FROM dbo.Products
    WHERE id = @resolved_id;
END;
GO

PRINT ' Product report catalog ready.';
