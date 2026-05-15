-- =====================================================================
-- 10_session_detail.sql
-- Move navigation details out of the sessions list and into a detail query.
-- =====================================================================

USE [sqldb-ingenial-ia];
GO

IF COL_LENGTH('dbo.UserSessions', 'routes') IS NOT NULL
BEGIN
    ALTER TABLE dbo.UserSessions DROP COLUMN routes;
END;
GO

IF OBJECT_ID('dbo.User_Sessions', 'U') IS NOT NULL
   AND COL_LENGTH('dbo.User_Sessions', 'routes') IS NOT NULL
BEGIN
    ALTER TABLE dbo.User_Sessions DROP COLUMN routes;
END;
GO

CREATE OR ALTER PROCEDURE dbo.GetUserSessionsInfo
AS
BEGIN
    SET NOCOUNT ON;

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

CREATE OR ALTER PROCEDURE dbo.GetSessionActivityDetail
    @SessionId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

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
        DATEDIFF(
            SECOND,
            COALESCE(us.login_time, us.issued_at, us.created_at),
            COALESCE(us.logout_time, us.last_activity_time, us.updated_at)
        ) AS total_seconds
    FROM dbo.UserSessions us
    INNER JOIN dbo.Users u ON us.user_id = u.user_id
    WHERE us.session_id = @SessionId;

    SELECT
        l.log_id,
        l.page_route,
        l.time_spent_seconds,
        l.created_at
    FROM dbo.Session_Navigation_Logs l
    WHERE l.session_id = @SessionId
    ORDER BY l.created_at ASC, l.log_id ASC;
END;
GO

PRINT '[10_session_detail] Session list/detail procedures updated.';
GO
