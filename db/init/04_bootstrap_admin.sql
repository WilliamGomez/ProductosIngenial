-- =====================================================================
-- 04_bootstrap_admin.sql · siembra del primer usuario Admin local.
-- ---------------------------------------------------------------------
-- Problema que resuelve:
--   Tras sembrar Roles/Permissions vía 03_rbac.sql, la tabla `dbo.[user]`
--   sigue vacía. Cuando un humano se loguea con MSAL, el backend hace
--   `GET /api/user/{oid}` → 404 → SessionContext deja `user=null` →
--   `useAuth().userRole` queda undefined → AppRouter no monta rutas
--   admin → el sidebar aparece vacío.
--
-- Estrategia:
--   Idempotent UPSERT del usuario Admin local usando dos variables que
--   `db-init` pasa por `sqlcmd -v`:
--     · BOOTSTRAP_ADMIN_OID   → UUID del usuario en Entra ID (claim `oid`)
--     · BOOTSTRAP_ADMIN_EMAIL → upn (ej. wgomez@ingenial-ia.com)
--
--   Si alguna está vacía → este script no hace nada (NO-OP).
--   Si ambas están seteadas → inserta el user (o lo deja activo + Admin
--   si ya existía).
--
-- Re-corrida:
--   100% idempotente. Re-ejecutar este script no duplica ni revierte
--   nada. Sirve también para "rescatar" un user que se hubiera quedado
--   con `enable=0` o sin rol Admin (lo re-pone Admin enable=1).
-- =====================================================================

USE [sqldb-ingenial-ia];
GO

SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

-- ---------------------------------------------------------------------
-- Las variables las inyecta db-init con `sqlcmd -v OID=... EMAIL=...`.
-- Cuando las env vars del compose están vacías, db-init pasa el sentinel
-- `__NONE__` (porque sqlcmd FALLA si recibe `-v VAR=` sin valor). Aquí
-- detectamos `__NONE__`, string vacío, o un `$(VAR)` no expandido y
-- salimos limpio sin tocar nada.
-- 
-- NOTA: Las variables de sqlcmd se envían sin comillas ni N'' prefix
-- en el inline -v, así que aquí las casteamos directamente a NVARCHAR.
-- Si llegan vacías (por -v OID=""), sqlcmd las expande a string vacío,
-- que nuestro check LTRIM(RTRIM(...)) = N'' captura sin problemas.
-- ---------------------------------------------------------------------
DECLARE @oid   NVARCHAR(80)  = N'$(OID)';
DECLARE @email NVARCHAR(120) = N'$(EMAIL)';

IF @oid IS NULL OR LTRIM(RTRIM(@oid)) = N''
   OR @oid = N'__NONE__'       -- sentinel cuando la env var está vacía
   OR @email IS NULL OR LTRIM(RTRIM(@email)) = N''
   OR @email = N'__NONE__'
BEGIN
    PRINT '[04_bootstrap_admin] BOOTSTRAP_ADMIN_OID/EMAIL no provistos — SKIP.';
    -- NO usamos RETURN aquí: en algunos modos sqlcmd interpreta un
    -- RETURN sin valor como exit-code distinto de 0 y marca el batch
    -- como fallido. Se deja un GOTO al final que es 100% portable.
    GOTO done;
END

-- Defensa: el dump base usa `dbo.Users` (plural). Si no encontramos
-- ninguna variante razonable, SKIP limpio.
IF OBJECT_ID(N'dbo.[user]', N'U') IS NULL
   AND OBJECT_ID(N'dbo.Users', N'U') IS NULL
BEGIN
    PRINT '[04_bootstrap_admin] tabla de usuarios no encontrada — SKIP.';
    GOTO done;
END

-- ---------------------------------------------------------------------
-- UPSERT: si existe, garantiza role=Admin + enable=1; si no, inserta.
-- El dump base usa `dbo.Users` (plural) con columna `user_id`. Nos
-- adaptamos a ese contrato cuando la tabla detectada es `Users`.
-- ---------------------------------------------------------------------
IF OBJECT_ID(N'dbo.Users', N'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.Users WHERE user_id = @oid)
    BEGIN
        UPDATE dbo.Users
           SET role = N'Admin',
               enable = 1,
               email = @email
         WHERE user_id = @oid;
        PRINT '[04_bootstrap_admin] Usuario existente promovido a Admin: ' + @email;
    END
    ELSE
    BEGIN
        INSERT INTO dbo.Users (user_id, email, display_name, enable, department, phone, role, created_at)
        VALUES (@oid, @email, @email, 1, N'IngenialAI', N'', N'Admin', SYSUTCDATETIME());
        PRINT '[04_bootstrap_admin] Admin local sembrado: ' + @email + ' (id=' + @oid + ')';
    END
END
ELSE
BEGIN
    -- Variante alternativa para entornos que usen `dbo.[user]` (singular)
    -- en lugar de `dbo.Users`. Mantiene el script trans-portable.
    IF EXISTS (SELECT 1 FROM dbo.[user] WHERE id = @oid)
    BEGIN
        UPDATE dbo.[user]
           SET role = N'Admin', enable = 1, email = @email
         WHERE id = @oid;
        PRINT '[04_bootstrap_admin] Usuario existente promovido a Admin: ' + @email;
    END
    ELSE
    BEGIN
        INSERT INTO dbo.[user] (id, email, display_name, enable, department, phone, role, created_at)
        VALUES (@oid, @email, @email, 1, N'IngenialAI', N'', N'Admin', SYSUTCDATETIME());
        PRINT '[04_bootstrap_admin] Admin local sembrado: ' + @email + ' (id=' + @oid + ')';
    END
END

done:
PRINT '[04_bootstrap_admin] fin.';
GO
