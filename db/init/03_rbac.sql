-- =====================================================================
-- 03_rbac.sql · Módulo RBAC dinámico (Roles, Permissions, RolePermissions)
-- ---------------------------------------------------------------------
-- Aplicado por `votometro-db-init` después de `02_geo_rls.sql`. El loop
-- en docker-compose.yml selecciona archivos con patrón [0-9][0-9]_*.sql
-- y los corre en orden lexicográfico, así que basta con el prefijo `03_`.
--
-- IDEMPOTENCIA:
--   · CREATE TABLE protegido por `IF OBJECT_ID(...) IS NULL`.
--   · Cada fila del seed (Roles, Permissions, RolePermissions) protegida
--     por `IF NOT EXISTS`. Re-ejecutar este script no duplica datos.
--
-- AUTORIZACIÓN (Clean Architecture):
--   La tabla `Roles.name` actúa como FK lógica de `User.role` (NVARCHAR).
--   Los roles `SuperAdmin`, `Admin` y `User` se siembran con is_system=1
--   y son inmutables vía API (ver UpdateRoleUseCase / DeleteRoleUseCase).
-- =====================================================================

USE [sqldb-ingenial-ia];
GO

-- DDL requiere QUOTED_IDENTIFIER ON; el base schema lo deja OFF a nivel BD,
-- así que lo forzamos en la sesión de este script.
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

-- ---------------------------------------------------------------------
-- 1. Tabla de Permisos (catálogo atómico)
-- ---------------------------------------------------------------------
IF OBJECT_ID(N'dbo.Permissions', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Permissions (
        id          UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        name        NVARCHAR(80)  NOT NULL UNIQUE,
        resource    NVARCHAR(40)  NOT NULL,
        [action]    NVARCHAR(40)  NOT NULL,
        module      NVARCHAR(40)  NOT NULL,
        description NVARCHAR(200) NULL
    );
END
GO

-- ---------------------------------------------------------------------
-- 2. Tabla de Roles (dinámicos + de sistema)
-- ---------------------------------------------------------------------
IF OBJECT_ID(N'dbo.Roles', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Roles (
        id          UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        name        NVARCHAR(40)  NOT NULL UNIQUE,
        description NVARCHAR(200) NULL,
        is_active   BIT NOT NULL DEFAULT 1,
        is_system   BIT NOT NULL DEFAULT 0,
        created_at  DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
END
GO

-- ---------------------------------------------------------------------
-- 3. Tabla de intersección (matriz de permisos por rol)
-- ---------------------------------------------------------------------
IF OBJECT_ID(N'dbo.RolePermissions', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.RolePermissions (
        role_id       UNIQUEIDENTIFIER NOT NULL,
        permission_id UNIQUEIDENTIFIER NOT NULL,
        CONSTRAINT PK_RolePermissions PRIMARY KEY (role_id, permission_id),
        CONSTRAINT FK_RolePermissions_Roles
            FOREIGN KEY (role_id)
            REFERENCES dbo.Roles(id)
            ON DELETE CASCADE,
        CONSTRAINT FK_RolePermissions_Permissions
            FOREIGN KEY (permission_id)
            REFERENCES dbo.Permissions(id)
            ON DELETE CASCADE
    );
END
GO

-- =====================================================================
-- SEED DE DATOS OBLIGATORIOS
-- ---------------------------------------------------------------------
-- Estrategia:
--   · `IF NOT EXISTS` en cada INSERT de Roles y Permissions.
--   · Los UNIQUEIDENTIFIER se descubren post-insert con SELECT ... WHERE
--     name = '<known>' para no depender de NEWID() devueltos.
--   · RolePermissions usa INSERT ... SELECT ... WHERE NOT EXISTS para
--     evitar violar la PK compuesta en re-ejecuciones.
-- =====================================================================

-- ---- 4. Seed de Roles del sistema -----------------------------------
IF NOT EXISTS (SELECT 1 FROM dbo.Roles WHERE name = N'SuperAdmin')
    INSERT INTO dbo.Roles (name, description, is_active, is_system)
    VALUES (N'SuperAdmin', N'Control total e irrestricto de la plataforma.', 1, 1);

IF NOT EXISTS (SELECT 1 FROM dbo.Roles WHERE name = N'Admin')
    INSERT INTO dbo.Roles (name, description, is_active, is_system)
    VALUES (N'Admin', N'Administrador de usuarios y operaciones.', 1, 1);

IF NOT EXISTS (SELECT 1 FROM dbo.Roles WHERE name = N'User')
    INSERT INTO dbo.Roles (name, description, is_active, is_system)
    VALUES (N'User', N'Usuario base de la plataforma.', 1, 1);
GO

-- ---- 5. Seed de Permisos atómicos -----------------------------------
IF NOT EXISTS (SELECT 1 FROM dbo.Permissions WHERE name = N'users.read')
    INSERT INTO dbo.Permissions (name, resource, [action], module, description)
    VALUES (N'users.read', N'users', N'read', N'Usuarios',
            N'Permite listar y ver detalles de usuarios.');

IF NOT EXISTS (SELECT 1 FROM dbo.Permissions WHERE name = N'users.write')
    INSERT INTO dbo.Permissions (name, resource, [action], module, description)
    VALUES (N'users.write', N'users', N'write', N'Usuarios',
            N'Permite crear o editar usuarios.');

IF NOT EXISTS (SELECT 1 FROM dbo.Permissions WHERE name = N'users.delete')
    INSERT INTO dbo.Permissions (name, resource, [action], module, description)
    VALUES (N'users.delete', N'users', N'delete', N'Usuarios',
            N'Permite eliminar usuarios del sistema.');

IF NOT EXISTS (SELECT 1 FROM dbo.Permissions WHERE name = N'sessions.view')
    INSERT INTO dbo.Permissions (name, resource, [action], module, description)
    VALUES (N'sessions.view', N'sessions', N'view', N'Sesiones',
            N'Permite ver el reporte de sesiones activas.');

IF NOT EXISTS (SELECT 1 FROM dbo.Permissions WHERE name = N'sessions.invalidate')
    INSERT INTO dbo.Permissions (name, resource, [action], module, description)
    VALUES (N'sessions.invalidate', N'sessions', N'invalidate', N'Sesiones',
            N'Permite forzar el cierre de sesión de otros usuarios.');

IF NOT EXISTS (SELECT 1 FROM dbo.Permissions WHERE name = N'powerbi.view')
    INSERT INTO dbo.Permissions (name, resource, [action], module, description)
    VALUES (N'powerbi.view', N'powerbi', N'view', N'PowerBI',
            N'Permite acceder a los tableros embebidos de Power BI.');

IF NOT EXISTS (SELECT 1 FROM dbo.Permissions WHERE name = N'roles.read')
    INSERT INTO dbo.Permissions (name, resource, [action], module, description)
    VALUES (N'roles.read', N'roles', N'read', N'Seguridad',
            N'Permite ver la matriz de roles y permisos.');

IF NOT EXISTS (SELECT 1 FROM dbo.Permissions WHERE name = N'roles.write')
    INSERT INTO dbo.Permissions (name, resource, [action], module, description)
    VALUES (N'roles.write', N'roles', N'write', N'Seguridad',
            N'Permite crear o modificar la matriz de roles y permisos.');
GO

-- ---- 6. Resolver IDs de roles (post-insert) -------------------------
DECLARE @SuperAdminID UNIQUEIDENTIFIER;
DECLARE @AdminID      UNIQUEIDENTIFIER;
DECLARE @UserID       UNIQUEIDENTIFIER;

SELECT @SuperAdminID = id FROM dbo.Roles WHERE name = N'SuperAdmin';
SELECT @AdminID      = id FROM dbo.Roles WHERE name = N'Admin';
SELECT @UserID       = id FROM dbo.Roles WHERE name = N'User';

-- ---- 7. Matriz de permisos -----------------------------------------
-- SuperAdmin → TODOS los permisos del catálogo (siempre).
INSERT INTO dbo.RolePermissions (role_id, permission_id)
SELECT @SuperAdminID, p.id
FROM dbo.Permissions p
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.RolePermissions rp
     WHERE rp.role_id = @SuperAdminID AND rp.permission_id = p.id
);

-- Admin → módulos operativos (Usuarios, Sesiones, PowerBI). NO Seguridad
-- por defecto — la edición de roles/permisos queda reservada a SuperAdmin.
INSERT INTO dbo.RolePermissions (role_id, permission_id)
SELECT @AdminID, p.id
FROM dbo.Permissions p
WHERE p.module IN (N'Usuarios', N'Sesiones', N'PowerBI')
  AND NOT EXISTS (
      SELECT 1 FROM dbo.RolePermissions rp
       WHERE rp.role_id = @AdminID AND rp.permission_id = p.id
  );

-- User → solo PowerBI (consumo de tableros).
INSERT INTO dbo.RolePermissions (role_id, permission_id)
SELECT @UserID, p.id
FROM dbo.Permissions p
WHERE p.module IN (N'PowerBI')
  AND NOT EXISTS (
      SELECT 1 FROM dbo.RolePermissions rp
       WHERE rp.role_id = @UserID AND rp.permission_id = p.id
  );
GO

PRINT '[03_rbac] OK · Roles/Permissions/RolePermissions listos.';
GO
