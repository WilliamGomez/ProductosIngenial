-- =====================================================================
-- 05_fix_session_sp.sql · parche para `CreateUserSession`.
-- ---------------------------------------------------------------------
-- Bug:
--   La tabla `dbo.UserSessions` declara `session_id UNIQUEIDENTIFIER NOT NULL`
--   como PRIMARY KEY pero SIN `DEFAULT NEWID()`. El SP `CreateUserSession`
--   tal como vino del dump NO incluye `session_id` en su INSERT, por lo que
--   SQL Server intenta insertar NULL en una PK NOT NULL y revienta con:
--
--     Cannot insert the value NULL into column 'session_id', table
--     'sqldb-ingenial-ia.dbo.UserSessions'; column does not allow nulls.
--
--   Esto provoca que `POST /api/session` devuelva 500 cada vez que un user
--   inicia sesión → el frontend se queda en "Cargando..." infinito porque
--   `SessionContext` nunca puede hidratar `user`.
--
-- Fix:
--   `CREATE OR ALTER PROCEDURE` reescribe el SP incluyendo
--   `session_id = NEWID()` en el INSERT. Es idempotente — re-correrlo no
--   tiene side-effects.
--
-- Por qué no `ALTER TABLE ... ADD CONSTRAINT DF_...`:
--   Modificar el default de la columna requiere DROP/CREATE de la PK,
--   lo que arriesga datos existentes. Parchar el SP es más quirúrgico,
--   mantiene la firma intacta y deja el schema sin tocar.
-- =====================================================================

USE [sqldb-ingenial-ia];
GO

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF COL_LENGTH('dbo.UserSessions', 'user_agent') IS NULL
    ALTER TABLE dbo.UserSessions ADD user_agent NVARCHAR(512) NULL;
GO

CREATE OR ALTER PROCEDURE [dbo].[CreateUserSession]
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

    INSERT INTO dbo.UserSessions (
        session_id,        -- ← fix: ahora incluido explícitamente
        user_id,
        device_id,
        session_token,
        issued_at,
        is_active,
        ip_address,
        is_blocked,
        created_at,
        updated_at,
        user_agent
    )
    VALUES (
        NEWID(),           -- ← fix: SQL genera el UUID en cada insert
        @UserId,
        @DeviceId,
        @SessionToken,
        @IssuedAt,
        @IsActive,
        @IpAddress,
        @IsBlocked,
        SWITCHOFFSET(SYSDATETIMEOFFSET(), '-05:00'),
        SWITCHOFFSET(SYSDATETIMEOFFSET(), '-05:00'),
        LEFT(@UserAgent, 512)
    );
END;
GO

PRINT '[05_fix_session_sp] CreateUserSession parcheado (NEWID() para session_id).';
GO
