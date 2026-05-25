-- =====================================================================
-- 12_uat_schema_seed.sql
-- UAT clean initialization: schema only + minimal non-legacy seed.
-- Do not import 01_base_schema.sql in UAT because it contains historical
-- users, sessions and commercial data.
-- =====================================================================

SET XACT_ABORT ON;
SET NOCOUNT ON;
GO

IF OBJECT_ID(N'dbo.Users', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Users (
        user_id           NVARCHAR(100) NOT NULL CONSTRAINT PK_Users PRIMARY KEY,
        email             NVARCHAR(100) NULL,
        display_name      NVARCHAR(100) NULL,
        enable            BIT NOT NULL CONSTRAINT DF_Users_enable DEFAULT 1,
        department        NVARCHAR(100) NULL,
        phone             NVARCHAR(20) NULL,
        role              NVARCHAR(50) NULL,
        created_at        DATETIME2(0) NOT NULL CONSTRAINT DF_Users_created DEFAULT SYSUTCDATETIME(),
        type_person       NVARCHAR(100) NULL,
        type_dni          NVARCHAR(100) NULL,
        reference         NVARCHAR(2500) NULL,
        identity_document NVARCHAR(50) NULL,
        personal_email    NVARCHAR(60) NULL,
        reference2        NVARCHAR(255) NULL
    );
END;
GO

CREATE OR ALTER PROCEDURE dbo.InsertUser
    @user_id NVARCHAR(100),
    @email NVARCHAR(100),
    @display_name NVARCHAR(100),
    @enable BIT,
    @department NVARCHAR(100),
    @phone NVARCHAR(20),
    @role NVARCHAR(50),
    @created_at DATETIME,
    @type_person NVARCHAR(100),
    @type_dni NVARCHAR(100),
    @identity_document NVARCHAR(50),
    @reference NVARCHAR(2500),
    @reference2 NVARCHAR(255),
    @personal_email NVARCHAR(60)
AS
BEGIN
    SET NOCOUNT ON;

    MERGE dbo.Users AS target
    USING (SELECT @user_id AS user_id) AS source
    ON target.user_id = source.user_id
    WHEN MATCHED THEN
        UPDATE SET
            email = @email,
            display_name = @display_name,
            enable = COALESCE(@enable, 1),
            department = @department,
            phone = @phone,
            role = @role,
            type_person = @type_person,
            type_dni = @type_dni,
            identity_document = @identity_document,
            reference = @reference,
            reference2 = @reference2,
            personal_email = @personal_email
    WHEN NOT MATCHED THEN
        INSERT (
            user_id, email, display_name, enable, department, phone, role,
            created_at, type_person, type_dni, identity_document, reference,
            reference2, personal_email
        )
        VALUES (
            @user_id, @email, @display_name, COALESCE(@enable, 1), @department,
            @phone, @role, COALESCE(@created_at, SYSUTCDATETIME()),
            @type_person, @type_dni, @identity_document, @reference,
            @reference2, @personal_email
        );
END;
GO

CREATE OR ALTER PROCEDURE dbo.UpdateUser
    @user_id NVARCHAR(100),
    @email NVARCHAR(100),
    @display_name NVARCHAR(100),
    @enable BIT,
    @department NVARCHAR(100),
    @phone NVARCHAR(20),
    @role NVARCHAR(50),
    @type_person NVARCHAR(100),
    @type_dni NVARCHAR(100),
    @identity_document NVARCHAR(50),
    @reference NVARCHAR(2500),
    @reference2 NVARCHAR(255),
    @personal_email NVARCHAR(60)
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE dbo.Users
       SET email = @email,
           display_name = @display_name,
           enable = COALESCE(@enable, enable),
           department = @department,
           phone = @phone,
           role = @role,
           type_person = @type_person,
           type_dni = @type_dni,
           identity_document = @identity_document,
           reference = @reference,
           reference2 = @reference2,
           personal_email = @personal_email
     WHERE user_id = @user_id;
END;
GO

IF OBJECT_ID(N'dbo.Products', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Products (
        id   INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Products PRIMARY KEY,
        name NVARCHAR(100) NOT NULL CONSTRAINT UQ_Products_Name UNIQUE
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM dbo.Products WHERE name = N'Votometro')
    INSERT INTO dbo.Products (name) VALUES (N'Votometro');
IF NOT EXISTS (SELECT 1 FROM dbo.Products WHERE name = N'Audivoto')
    INSERT INTO dbo.Products (name) VALUES (N'Audivoto');
GO

IF OBJECT_ID(N'dbo.User_Products', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.User_Products (
        id                INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_UserProducts PRIMARY KEY,
        user_id           NVARCHAR(100) NOT NULL CONSTRAINT FK_UserProducts_Users REFERENCES dbo.Users(user_id) ON DELETE CASCADE,
        product_id        INT NOT NULL CONSTRAINT FK_UserProducts_Products REFERENCES dbo.Products(id),
        contract_duration INT NULL,
        duration_unit     NVARCHAR(20) NULL,
        expiration        DATETIME NULL,
        amount_cop        DECIMAL(10, 2) NULL,
        enable            BIT NOT NULL CONSTRAINT DF_UserProducts_enable DEFAULT 1,
        created_at        DATETIME2(0) NOT NULL CONSTRAINT DF_UserProducts_created DEFAULT SYSUTCDATETIME(),
        updated_at        DATETIME2(0) NULL,
        CONSTRAINT UQ_UserProducts_User_Product UNIQUE (user_id, product_id)
    );
END;
GO

IF OBJECT_ID(N'dbo.User_Zones', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.User_Zones (
        id              INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_UserZones PRIMARY KEY,
        user_product_id INT NOT NULL CONSTRAINT FK_UserZones_UserProducts REFERENCES dbo.User_Products(id) ON DELETE CASCADE,
        cod_dep         VARCHAR(2) NOT NULL,
        cod_mun         VARCHAR(3) NULL,
        enable          BIT NOT NULL CONSTRAINT DF_UserZones_enable DEFAULT 1,
        created_at      DATETIME2(0) NOT NULL CONSTRAINT DF_UserZones_created DEFAULT SYSUTCDATETIME(),
        updated_at      DATETIME2(0) NULL,
        CONSTRAINT CK_UserZones_CodDep_2 CHECK (LEN(cod_dep) = 2),
        CONSTRAINT CK_UserZones_CodMun_3 CHECK (cod_mun IS NULL OR LEN(cod_mun) = 3)
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_UserZones_UserProduct' AND object_id = OBJECT_ID(N'dbo.User_Zones'))
    CREATE INDEX IX_UserZones_UserProduct ON dbo.User_Zones(user_product_id) INCLUDE (cod_dep, cod_mun, enable);
GO

IF OBJECT_ID(N'dbo.DIVIPOLA', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.DIVIPOLA (
        cod_eleccion VARCHAR(20) NOT NULL,
        dep          VARCHAR(2) NOT NULL,
        nom_dep      VARCHAR(150) NOT NULL,
        mun          VARCHAR(3) NOT NULL,
        nom_mun      VARCHAR(150) NOT NULL,
        zz           VARCHAR(2) NULL,
        pp           VARCHAR(2) NULL,
        nom_puesto   VARCHAR(150) NULL
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_DIVIPOLA_Geo' AND object_id = OBJECT_ID(N'dbo.DIVIPOLA'))
    CREATE INDEX IX_DIVIPOLA_Geo ON dbo.DIVIPOLA(dep, mun);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_DIVIPOLA_DepName' AND object_id = OBJECT_ID(N'dbo.DIVIPOLA'))
    CREATE INDEX IX_DIVIPOLA_DepName ON dbo.DIVIPOLA(nom_dep);
GO

IF OBJECT_ID(N'dbo.UserSessions', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.UserSessions (
        session_id         UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_UserSessions PRIMARY KEY DEFAULT NEWID(),
        user_id            NVARCHAR(255) NOT NULL,
        device_id          NVARCHAR(100) NOT NULL,
        session_token      NVARCHAR(255) NOT NULL,
        issued_at          DATETIME2(7) NOT NULL,
        expires_at         DATETIME2(7) NULL,
        is_active          BIT NOT NULL CONSTRAINT DF_UserSessions_active DEFAULT 1,
        ip_address         NVARCHAR(45) NOT NULL,
        is_blocked         BIT NOT NULL CONSTRAINT DF_UserSessions_blocked DEFAULT 0,
        created_at         DATETIME2(7) NOT NULL CONSTRAINT DF_UserSessions_created DEFAULT SYSUTCDATETIME(),
        updated_at         DATETIME2(7) NOT NULL CONSTRAINT DF_UserSessions_updated DEFAULT SYSUTCDATETIME(),
        login_time         DATETIME2(7) NULL,
        last_activity_time DATETIME2(7) NULL,
        logout_time        DATETIME2(7) NULL,
        status             NVARCHAR(30) NOT NULL CONSTRAINT DF_UserSessions_status DEFAULT N'Active',
        user_agent         NVARCHAR(512) NULL
    );
END;
GO

IF COL_LENGTH('dbo.UserSessions', 'user_agent') IS NULL
    ALTER TABLE dbo.UserSessions ADD user_agent NVARCHAR(512) NULL;
GO

IF OBJECT_ID(N'dbo.Session_Navigation_Logs', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Session_Navigation_Logs (
        log_id             BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_SessionNavigationLogs PRIMARY KEY,
        session_id         UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_SessionNavigationLogs_UserSessions REFERENCES dbo.UserSessions(session_id) ON DELETE CASCADE,
        page_route         NVARCHAR(512) NOT NULL,
        time_spent_seconds INT NOT NULL,
        created_at         DATETIME2(7) NOT NULL CONSTRAINT DF_SessionNavigationLogs_created DEFAULT SYSUTCDATETIME()
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_SessionNavigationLogs_Session' AND object_id = OBJECT_ID(N'dbo.Session_Navigation_Logs'))
    CREATE INDEX IX_SessionNavigationLogs_Session ON dbo.Session_Navigation_Logs(session_id, created_at);
GO

IF OBJECT_ID(N'dbo.Permissions', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Permissions (
        id          UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_Permissions PRIMARY KEY DEFAULT NEWID(),
        name        NVARCHAR(100) NOT NULL,
        resource    NVARCHAR(100) NOT NULL,
        [action]    NVARCHAR(50) NOT NULL,
        module      NVARCHAR(100) NOT NULL,
        description NVARCHAR(255) NULL,
        CONSTRAINT UQ_Permissions_Name UNIQUE (name)
    );
END;
GO

IF OBJECT_ID(N'dbo.Roles', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Roles (
        id          UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_Roles PRIMARY KEY DEFAULT NEWID(),
        name        NVARCHAR(100) NOT NULL CONSTRAINT UQ_Roles_Name UNIQUE,
        description NVARCHAR(255) NULL,
        is_active   BIT NOT NULL CONSTRAINT DF_Roles_active DEFAULT 1,
        is_system   BIT NOT NULL CONSTRAINT DF_Roles_system DEFAULT 0,
        created_at  DATETIME2(0) NOT NULL CONSTRAINT DF_Roles_created DEFAULT SYSUTCDATETIME()
    );
END;
GO

IF OBJECT_ID(N'dbo.RolePermissions', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.RolePermissions (
        role_id       UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_RolePermissions_Roles REFERENCES dbo.Roles(id) ON DELETE CASCADE,
        permission_id UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_RolePermissions_Permissions REFERENCES dbo.Permissions(id) ON DELETE CASCADE,
        CONSTRAINT PK_RolePermissions PRIMARY KEY (role_id, permission_id)
    );
END;
GO

MERGE dbo.Roles AS target
USING (VALUES
    (N'Admin', N'Administrador UAT', CONVERT(BIT, 1)),
    (N'User', N'Usuario UAT', CONVERT(BIT, 1))
) AS source(name, description, is_system)
ON target.name = source.name
WHEN MATCHED THEN UPDATE SET description = source.description, is_system = source.is_system, is_active = 1
WHEN NOT MATCHED THEN INSERT (name, description, is_system) VALUES (source.name, source.description, source.is_system);
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

    INSERT INTO @incoming (name, contract_duration, duration_unit, expiration, amount_cop, enable, zones)
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

    MERGE dbo.User_Products AS target
    USING (
        SELECT @user_id AS user_id, p.id AS product_id, i.contract_duration,
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
    ON target.user_id = source.user_id AND target.product_id = source.product_id
    WHEN MATCHED THEN
        UPDATE SET contract_duration = source.contract_duration,
                   duration_unit = source.duration_unit,
                   expiration = source.expiration,
                   amount_cop = source.amount_cop,
                   enable = source.enable,
                   updated_at = SYSUTCDATETIME()
    WHEN NOT MATCHED THEN
        INSERT (user_id, product_id, contract_duration, duration_unit, expiration, amount_cop, enable, updated_at)
        VALUES (source.user_id, source.product_id, source.contract_duration, source.duration_unit,
                source.expiration, source.amount_cop, source.enable, SYSUTCDATETIME());

    DELETE uz
    FROM dbo.User_Zones uz
    INNER JOIN dbo.User_Products up ON up.id = uz.user_product_id
    INNER JOIN dbo.Products p ON p.id = up.product_id
    INNER JOIN @incoming i ON i.name = p.name
    WHERE up.user_id = @user_id;

    INSERT INTO dbo.User_Zones (user_product_id, cod_dep, cod_mun, enable)
    SELECT
        up.id,
        RIGHT('00' + JSON_VALUE(z.value, '$.cod_dep'), 2),
        CASE WHEN NULLIF(JSON_VALUE(z.value, '$.cod_mun'), '') IS NULL
             THEN NULL
             ELSE RIGHT('000' + JSON_VALUE(z.value, '$.cod_mun'), 3)
        END,
        COALESCE(TRY_CONVERT(BIT, JSON_VALUE(z.value, '$.enable')), 1)
    FROM @incoming i
    INNER JOIN dbo.Products p ON p.name = i.name
    INNER JOIN dbo.User_Products up ON up.user_id = @user_id AND up.product_id = p.id
    CROSS APPLY OPENJSON(COALESCE(i.zones, N'[]')) z;

    COMMIT;
END;
GO

CREATE OR ALTER PROCEDURE dbo.UpsertUserZonesForProduct
    @user_product_id INT,
    @assignments NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.User_Products WHERE id = @user_product_id)
        THROW 51000, 'User_Products row not found', 1;

    BEGIN TRAN;

    DELETE FROM dbo.User_Zones WHERE user_product_id = @user_product_id;

    INSERT INTO dbo.User_Zones (user_product_id, cod_dep, cod_mun, enable)
    SELECT
        @user_product_id,
        RIGHT('00' + JSON_VALUE(j.value, '$.cod_dep'), 2),
        CASE WHEN NULLIF(JSON_VALUE(j.value, '$.cod_mun'), '') IS NULL
             THEN NULL
             ELSE RIGHT('000' + JSON_VALUE(j.value, '$.cod_mun'), 3)
        END,
        COALESCE(TRY_CONVERT(BIT, JSON_VALUE(j.value, '$.enable')), 1)
    FROM OPENJSON(@assignments) AS j;

    COMMIT;
END;
GO

CREATE OR ALTER PROCEDURE dbo.CreateUserSession
    @user_id NVARCHAR(255),
    @device_id NVARCHAR(100),
    @session_token NVARCHAR(255),
    @issued_at DATETIME2,
    @ip_address NVARCHAR(45),
    @is_active BIT,
    @is_blocked BIT,
    @user_agent NVARCHAR(512) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Now DATETIME2 = COALESCE(@issued_at, SWITCHOFFSET(SYSDATETIMEOFFSET(), '-05:00'));

    INSERT INTO dbo.UserSessions (
        session_id, user_id, device_id, session_token, issued_at, expires_at,
        is_active, ip_address, is_blocked, created_at, updated_at,
        login_time, last_activity_time, status, user_agent
    )
    VALUES (
        NEWID(), @user_id, @device_id, @session_token, @Now, NULL,
        COALESCE(@is_active, 1), @ip_address, COALESCE(@is_blocked, 0),
        @Now, @Now, @Now, @Now, N'Active', LEFT(@user_agent, 512)
    );
END;
GO

CREATE OR ALTER PROCEDURE dbo.InvalidateUserSessions
    @user_id NVARCHAR(255),
    @device_id NVARCHAR(100)
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Now DATETIME2 = SWITCHOFFSET(SYSDATETIMEOFFSET(), '-05:00');
    UPDATE dbo.UserSessions
       SET is_active = 0,
           status = N'Closed',
           logout_time = COALESCE(logout_time, @Now),
           last_activity_time = COALESCE(last_activity_time, @Now),
           updated_at = @Now
     WHERE user_id = @user_id
       AND device_id = @device_id
       AND is_active = 1;
END;
GO

CREATE OR ALTER PROCEDURE dbo.ExpireIdleUserSessions
    @IdleTimeoutSeconds INT = 7200
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Now DATETIME2 = SWITCHOFFSET(SYSDATETIMEOFFSET(), '-05:00');

    UPDATE dbo.UserSessions
       SET is_active = 0,
           status = N'Expired_Idle',
           logout_time = COALESCE(
               logout_time,
               DATEADD(SECOND, @IdleTimeoutSeconds, COALESCE(last_activity_time, issued_at, created_at))
           ),
           updated_at = @Now
     WHERE is_active = 1
       AND COALESCE(status, N'Active') = N'Active'
       AND DATEDIFF(SECOND, COALESCE(last_activity_time, issued_at, created_at), @Now) > @IdleTimeoutSeconds;
END;
GO

CREATE OR ALTER PROCEDURE dbo.GetActiveSessionByUserId
    @user_id NVARCHAR(255),
    @device_id NVARCHAR(100)
AS
BEGIN
    SET NOCOUNT ON;

    EXEC dbo.ExpireIdleUserSessions @IdleTimeoutSeconds = 7200;

    SELECT TOP 1 *
    FROM dbo.UserSessions
    WHERE user_id = @user_id
      AND device_id = @device_id
      AND is_active = 1
      AND is_blocked = 0
      AND status = N'Active'
    ORDER BY issued_at DESC;
END;
GO

CREATE OR ALTER PROCEDURE dbo.GetDeviceIdBySessionId
    @session_id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT device_id
    FROM dbo.UserSessions
    WHERE session_id = @session_id;
END;
GO

CREATE OR ALTER PROCEDURE dbo.InvalidateAllUserSessions
    @user_id NVARCHAR(255)
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Now DATETIME2 = SWITCHOFFSET(SYSDATETIMEOFFSET(), '-05:00');
    UPDATE dbo.UserSessions
       SET is_active = 0,
           status = N'Closed',
           logout_time = COALESCE(logout_time, @Now),
           last_activity_time = COALESCE(last_activity_time, @Now),
           updated_at = @Now
     WHERE user_id = @user_id
       AND is_active = 1;
END;
GO

CREATE OR ALTER PROCEDURE dbo.RevokeUserSession
    @session_id NVARCHAR(100)
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Now DATETIME2 = SWITCHOFFSET(SYSDATETIMEOFFSET(), '-05:00');

    UPDATE dbo.UserSessions
       SET is_active = 0,
           status = N'Revoked_by_Admin',
           logout_time = @Now,
           last_activity_time = COALESCE(last_activity_time, @Now),
           updated_at = @Now
     WHERE session_id = TRY_CONVERT(UNIQUEIDENTIFIER, @session_id);

    SELECT @@ROWCOUNT AS affected_rows;
END;
GO

CREATE OR ALTER PROCEDURE dbo.GetUserSessionsInfo
AS
BEGIN
    SET NOCOUNT ON;

    EXEC dbo.ExpireIdleUserSessions @IdleTimeoutSeconds = 7200;

    SELECT
        us.session_id,
        us.user_id,
        u.email,
        u.display_name,
        us.device_id,
        us.ip_address,
        us.issued_at,
        us.login_time,
        us.last_activity_time,
        us.logout_time,
        us.status,
        us.is_active,
        us.is_blocked,
        DATEDIFF(SECOND, COALESCE(us.login_time, us.issued_at, us.created_at), COALESCE(us.logout_time, us.last_activity_time, us.updated_at)) AS duration_seconds
    FROM dbo.UserSessions us
    INNER JOIN dbo.Users u ON u.user_id = us.user_id
    ORDER BY us.issued_at DESC;
END;
GO

CREATE OR ALTER PROCEDURE dbo.GetSessionActivityDetail
    @session_id NVARCHAR(100)
AS
BEGIN
    SET NOCOUNT ON;

    EXEC dbo.ExpireIdleUserSessions @IdleTimeoutSeconds = 7200;

    SELECT
        us.session_id,
        u.user_id,
        u.email,
        u.display_name,
        us.ip_address,
        us.status,
        us.is_active,
        us.is_blocked,
        us.issued_at,
        us.login_time,
        us.last_activity_time,
        us.logout_time,
        DATEDIFF(SECOND, COALESCE(us.login_time, us.issued_at, us.created_at), COALESCE(us.logout_time, us.last_activity_time, us.updated_at)) AS total_seconds
    FROM dbo.UserSessions us
    INNER JOIN dbo.Users u ON us.user_id = u.user_id
    WHERE us.session_id = TRY_CONVERT(UNIQUEIDENTIFIER, @session_id);

    SELECT
        MIN(l.log_id) AS log_id,
        l.page_route,
        SUM(l.time_spent_seconds) AS time_spent_seconds,
        MIN(l.created_at) AS created_at
    FROM dbo.Session_Navigation_Logs l
    WHERE l.session_id = TRY_CONVERT(UNIQUEIDENTIFIER, @session_id)
    GROUP BY l.page_route
    ORDER BY SUM(l.time_spent_seconds) DESC, MIN(l.created_at) ASC;
END;
GO

CREATE OR ALTER PROCEDURE dbo.UpsertUatAdminUser
    @user_id NVARCHAR(100),
    @email NVARCHAR(100),
    @display_name NVARCHAR(100)
AS
BEGIN
    SET NOCOUNT ON;
    EXEC dbo.InsertUser
        @user_id = @user_id,
        @email = @email,
        @display_name = @display_name,
        @enable = 1,
        @department = N'UAT',
        @phone = NULL,
        @role = N'Admin',
        @created_at = NULL,
        @type_person = N'UAT',
        @type_dni = NULL,
        @identity_document = NULL,
        @reference = N'UAT deploy seed',
        @reference2 = NULL,
        @personal_email = @email;

    DECLARE @products NVARCHAR(MAX) = N'[
        {"name":"Votometro","contract_duration":1,"duration_unit":"months","expiration":null,"amount_cop":0,"enable":true,"zones":[{"cod_dep":"05","cod_mun":null,"enable":true}]},
        {"name":"Audivoto","contract_duration":1,"duration_unit":"months","expiration":null,"amount_cop":0,"enable":true,"zones":[{"cod_dep":"05","cod_mun":null,"enable":true}]}
    ]';
    EXEC dbo.UpsertUserProducts @user_id = @user_id, @products_json = @products;
END;
GO

PRINT '[12_uat_schema_seed] UAT schema initialized without legacy data.';
GO
