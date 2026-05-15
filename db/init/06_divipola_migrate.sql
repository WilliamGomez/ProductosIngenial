/*
 * Superseded by:
 *   - 02_geo_rls.sql
 *   - 07_divipola_single_master.sql
 *
 * This file used to create an old dbo.Divipola shape with cod_dep/cod_mun.
 * The canonical table is now dbo.DIVIPOLA with Registraduria electoral
 * columns: dep, nom_dep, mun, nom_mun, zz, pp, nom_puesto.
 */

USE [sqldb-ingenial-ia];
GO

PRINT '[06_divipola_migrate] superseded; no schema changes applied.';
GO
