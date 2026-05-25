-- =====================================================================
-- 13_session_analytics.sql
-- Adds browser/user-agent capture for session analytics.
-- =====================================================================

USE [sqldb-ingenial-ia];
GO

IF COL_LENGTH('dbo.UserSessions', 'user_agent') IS NULL
    ALTER TABLE dbo.UserSessions ADD user_agent NVARCHAR(512) NULL;
GO

PRINT ' Session analytics browser metadata ready.';
GO
