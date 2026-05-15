-- =====================================================================
-- 09_revoke_session.sql
-- Admin session revocation.
-- =====================================================================

USE [sqldb-ingenial-ia];
GO

IF EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = N'CK_UserSessions_Status'
      AND parent_object_id = OBJECT_ID(N'dbo.UserSessions')
)
BEGIN
    ALTER TABLE dbo.UserSessions DROP CONSTRAINT CK_UserSessions_Status;
END;
GO

ALTER TABLE dbo.UserSessions
ADD CONSTRAINT CK_UserSessions_Status
CHECK (
    status IS NULL
    OR status IN (N'Active', N'Closed', N'Expired_Idle', N'Revoked_by_Admin')
);
GO

CREATE OR ALTER PROCEDURE dbo.RevokeUserSession
    @SessionId UNIQUEIDENTIFIER
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
    WHERE session_id = @SessionId;

    SELECT @@ROWCOUNT AS affected_rows;
END;
GO

PRINT '[09_revoke_session] RevokeUserSession ready.';
GO
