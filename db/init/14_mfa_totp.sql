SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF COL_LENGTH('dbo.Users', 'mfa_enabled') IS NULL
BEGIN
    ALTER TABLE dbo.Users
    ADD mfa_enabled BIT NOT NULL
        CONSTRAINT DF_Users_mfa_enabled DEFAULT 0;
END;
GO

IF COL_LENGTH('dbo.Users', 'mfa_secret_encrypted') IS NULL
BEGIN
    ALTER TABLE dbo.Users
    ADD mfa_secret_encrypted NVARCHAR(MAX) NULL;
END;
GO

IF COL_LENGTH('dbo.Users', 'mfa_enrolled_at') IS NULL
BEGIN
    ALTER TABLE dbo.Users
    ADD mfa_enrolled_at DATETIME2 NULL;
END;
GO

IF COL_LENGTH('dbo.Users', 'mfa_reset_at') IS NULL
BEGIN
    ALTER TABLE dbo.Users
    ADD mfa_reset_at DATETIME2 NULL;
END;
GO

IF COL_LENGTH('dbo.UserSessions', 'mfa_verified') IS NULL
BEGIN
    ALTER TABLE dbo.UserSessions
    ADD mfa_verified BIT NOT NULL
        CONSTRAINT DF_UserSessions_mfa_verified DEFAULT 0;
END;
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
    OR status IN (N'MFA_Pending', N'Active', N'Closed', N'Expired_Idle', N'Revoked_by_Admin')
);
GO

CREATE OR ALTER PROCEDURE dbo.MarkSessionMfaPending
    @user_id NVARCHAR(100),
    @session_token NVARCHAR(255)
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE dbo.UserSessions
       SET status = N'MFA_Pending',
           mfa_verified = 0,
           is_active = 1,
           updated_at = SWITCHOFFSET(SYSDATETIMEOFFSET(), '-05:00')
     WHERE user_id = @user_id
       AND session_token = @session_token;
END;
GO

CREATE OR ALTER PROCEDURE dbo.MarkSessionMfaVerified
    @user_id NVARCHAR(100),
    @session_token NVARCHAR(255)
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE dbo.UserSessions
       SET status = N'Active',
           mfa_verified = 1,
           is_active = 1,
           last_activity_time = SWITCHOFFSET(SYSDATETIMEOFFSET(), '-05:00'),
           updated_at = SWITCHOFFSET(SYSDATETIMEOFFSET(), '-05:00')
     WHERE user_id = @user_id
       AND session_token = @session_token
       AND is_active = 1;

    SELECT @@ROWCOUNT AS affected_rows;
END;
GO

PRINT '[14_mfa_totp] MFA TOTP schema ready.';
