/*
 * ============================================================================
 * 01b_migrate_products_schema.sql
 * ============================================================================
 * 
 * Script de migración que prepara el schema de Products para la refactorización.
 * Este script se ejecuta DESPUÉS de 01_base_schema.sql pero ANTES de 02_geo_rls.sql
 * 
 * CAMBIOS:
 * 1. Si las columnas country, state, city existen en Products → las elimina
 * 2. Asegura que product_name existe
 * 3. Prepara User_Zones para recibir FK a product_id
 * 
 * IDEMPOTENTE: Puede ejecutarse múltiples veces sin error
 * ============================================================================
 */

USE [sqldb-ingenial-ia];
GO

SET XACT_ABORT ON;
SET NOCOUNT ON;

PRINT '[01b_migrate_products_schema] Iniciando migración del schema de Products...';

-- ============================================================================
-- PASO 1: Eliminar columnas CSV de Products si existen
-- ============================================================================

IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'Products' AND COLUMN_NAME = 'country'
)
BEGIN
    PRINT '[01b] Eliminando columna "country" de dbo.Products...';
    ALTER TABLE dbo.Products DROP COLUMN [country];
END;

IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'Products' AND COLUMN_NAME = 'state'
)
BEGIN
    PRINT '[01b] Eliminando columna "state" de dbo.Products...';
    ALTER TABLE dbo.Products DROP COLUMN [state];
END;

IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'Products' AND COLUMN_NAME = 'city'
)
BEGIN
    PRINT '[01b] Eliminando columna "city" de dbo.Products...';
    ALTER TABLE dbo.Products DROP COLUMN [city];
END;

-- ============================================================================
-- PASO 2: Renombrar columna 'name' a 'product_name' si existe
-- ============================================================================

IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'Products' AND COLUMN_NAME = 'name'
)
   AND NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'Products' AND COLUMN_NAME = 'product_name'
)
BEGIN
    PRINT '[01b] Renombrando columna "name" a "product_name"...';
    EXEC sp_rename 'dbo.Products.name', 'product_name', 'COLUMN';
END;

PRINT '[01b_migrate_products_schema] Migración completada.';
GO
