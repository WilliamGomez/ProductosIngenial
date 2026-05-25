-- =====================================================================
-- 08_session_audit.sql
-- Session audit trail + navigation telemetry.
-- Idempotent patch for the existing dbo.UserSessions model.
-- =====================================================================

USE [sqldb-ingenial-ia];
GO

IF COL_LENGTH('dbo.UserSessions', 'login_time') IS NULL
    ALTER TABLE dbo.UserSessions ADD login_time DATETIME2 NULL;
GO

IF COL_LENGTH('dbo.UserSessions', 'last_activity_time') IS NULL
    ALTER TABLE dbo.UserSessions ADD last_activity_time DATETIME2 NULL;
GO

IF COL_LENGTH('dbo.UserSessions', 'logout_time') IS NULL
    ALTER TABLE dbo.UserSessions ADD logout_time DATETIME2 NULL;
GO

IF COL_LENGTH('dbo.UserSessions', 'status') IS NULL
    ALTER TABLE dbo.UserSessions ADD status NVARCHAR(20) NULL;
GO

IF COL_LENGTH('dbo.UserSessions', 'user_agent') IS NULL
    ALTER TABLE dbo.UserSessions ADD user_agent NVARCHAR(512) NULL;
GO

UPDATE dbo.UserSessions
SET
    login_time = COALESCE(login_time, issued_at, created_at),
    last_activity_time = COALESCE(last_activity_time, updated_at, issued_at, created_at),
    logout_time = CASE
        WHEN is_active = 0 THEN COALESCE(logout_time, updated_at)
        ELSE logout_time
    END,
    status = COALESCE(status, CASE WHEN is_active = 1 THEN N'Active' ELSE N'Closed' END)
WHERE login_time IS NULL
   OR last_activity_time IS NULL
   OR status IS NULL;
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

IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = N'CK_UserSessions_Status'
      AND parent_object_id = OBJECT_ID(N'dbo.UserSessions')
)
BEGIN
    ALTER TABLE dbo.UserSessions
    ADD CONSTRAINT CK_UserSessions_Status
    CHECK (status IS NULL OR status IN (N'Active', N'Closed', N'Expired_Idle'));
END;
GO

IF OBJECT_ID(N'dbo.Session_Navigation_Logs', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Session_Navigation_Logs (
        log_id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        session_id UNIQUEIDENTIFIER NOT NULL,
        page_route NVARCHAR(512) NOT NULL,
        time_spent_seconds INT NOT NULL,
        created_at DATETIME2 NOT NULL
            CONSTRAINT DF_SessionNavigationLogs_created_at
            DEFAULT SWITCHOFFSET(SYSDATETIMEOFFSET(), '-05:00'),
        CONSTRAINT FK_SessionNavigationLogs_UserSessions
            FOREIGN KEY (session_id)
            REFERENCES dbo.UserSessions(session_id)
            ON DELETE CASCADE,
        CONSTRAINT CK_SessionNavigationLogs_TimeSpent
            CHECK (time_spent_seconds >= 0)
    );
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_SessionNavigationLogs_SessionRoute'
      AND object_id = OBJECT_ID(N'dbo.Session_Navigation_Logs')
)
BEGIN
    CREATE INDEX IX_SessionNavigationLogs_SessionRoute
    ON dbo.Session_Navigation_Logs(session_id, page_route)
    INCLUDE (time_spent_seconds, created_at);
END;
GO

CREATE OR ALTER PROCEDURE dbo.CreateUserSession
    @UserId        NVARCHAR(255),
    @DeviceId      NVARCHAR(100),
    @SessionToken  NVARCHAR(255),
    @IssuedAt      DATETIME2,
    @IpAddress     NVARCHAR(45),
    @IsActive      BIT = 1,
    @IsBlocked     BIT = 0,
    @UserAgent     NVARCHAR(512) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Now DATETIME2 = SWITCHOFFSET(SYSDATETIMEOFFSET(), '-05:00');

    INSERT INTO dbo.UserSessions (
        session_id,
        user_id,
        device_id,
        session_token,
        issued_at,
        expires_at,
        is_active,
        ip_address,
        is_blocked,
        created_at,
        updated_at,
        login_time,
        last_activity_time,
        logout_time,
        status,
        user_agent
    )
    VALUES (
        NEWID(),
        @UserId,
        @DeviceId,
        @SessionToken,
        @IssuedAt,
        NULL,
        @IsActive,
        @IpAddress,
        @IsBlocked,
        @Now,
        @Now,
        @IssuedAt,
        @IssuedAt,
        NULL,
        CASE WHEN @IsActive = 1 THEN N'Active' ELSE N'Closed' END,
        LEFT(@UserAgent, 512)
    );
END;
GO

CREATE OR ALTER PROCEDURE dbo.InvalidateAllUserSessions
    @UserId NVARCHAR(255)
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Now DATETIME2 = SWITCHOFFSET(SYSDATETIMEOFFSET(), '-05:00');

    UPDATE dbo.UserSessions
    SET is_active = 0,
        status = CASE WHEN status = N'Expired_Idle' THEN status ELSE N'Closed' END,
        logout_time = COALESCE(logout_time, @Now),
        last_activity_time = COALESCE(last_activity_time, @Now),
        updated_at = @Now
    WHERE user_id = @UserId
      AND is_active = 1;
END;
GO

CREATE OR ALTER PROCEDURE dbo.InvalidateUserSessions
    @UserId NVARCHAR(255),
    @DeviceId NVARCHAR(100)
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Now DATETIME2 = SWITCHOFFSET(SYSDATETIMEOFFSET(), '-05:00');

    UPDATE dbo.UserSessions
    SET is_active = 0,
        status = CASE WHEN status = N'Expired_Idle' THEN status ELSE N'Closed' END,
        logout_time = COALESCE(logout_time, @Now),
        last_activity_time = COALESCE(last_activity_time, @Now),
        updated_at = @Now
    WHERE user_id = @UserId
      AND device_id = @DeviceId
      AND is_active = 1;
END;
GO

CREATE OR ALTER PROCEDURE dbo.GetActiveSessionByUserId
    @UserId NVARCHAR(255),
    @DeviceId NVARCHAR(255)
AS
BEGIN
    SET NOCOUNT ON;

    EXEC dbo.ExpireIdleUserSessions @IdleTimeoutSeconds = 7200;

    SELECT TOP 1
        us.session_id,
        u.user_id,
        u.email,
        u.display_name,
        us.device_id,
        us.session_token,
        us.issued_at,
        us.login_time,
        us.last_activity_time,
        us.logout_time,
        us.status,
        us.ip_address,
        us.is_active,
        us.is_blocked,
        DATEDIFF(
            SECOND,
            COALESCE(us.login_time, us.issued_at, us.created_at),
            COALESCE(us.logout_time, us.last_activity_time, us.updated_at)
        ) AS diff_seconds
    FROM dbo.UserSessions us
    INNER JOIN dbo.Users u ON us.user_id = u.user_id
    WHERE us.user_id = @UserId
      AND us.device_id = @DeviceId
    ORDER BY us.issued_at DESC;
END;
GO

CREATE OR ALTER PROCEDURE dbo.GetUserSessionsInfo
AS
BEGIN
    SET NOCOUNT ON;

    EXEC dbo.ExpireIdleUserSessions @IdleTimeoutSeconds = 7200;

    SELECT
        us.session_id,
        u.user_id,
        u.email,
        u.display_name,
        us.device_id,
        us.session_token,
        us.issued_at,
        us.login_time,
        us.last_activity_time,
        us.logout_time,
        us.status,
        us.ip_address,
        us.is_active,
        us.is_blocked,
        DATEDIFF(
            SECOND,
            COALESCE(us.login_time, us.issued_at, us.created_at),
            COALESCE(us.logout_time, us.last_activity_time, us.updated_at)
        ) AS diff_seconds
    FROM dbo.UserSessions us
    INNER JOIN dbo.Users u ON us.user_id = u.user_id
    ORDER BY COALESCE(us.login_time, us.issued_at) DESC;
END;
GO

PRINT '[08_session_audit] Session audit schema and procedures updated.';
GO
