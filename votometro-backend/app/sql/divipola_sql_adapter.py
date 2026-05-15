"""DIVIPOLA SQL adapter for the Registraduria electoral schema."""

import logging
import os
from typing import List

import pyodbc

from domain.models.divipola import DivipolaEntry
from domain.repositories.divipola_sql_repository import IDivipolaSqlRepository


_BATCH_SIZE = 500


class DivipolaSqlAdapter(IDivipolaSqlRepository):
    def __init__(self):
        self.connection = pyodbc.connect(os.getenv("SQL_CONNECTION_STRING"))

    def bulk_upsert(self, entries: List[DivipolaEntry]) -> dict:
        if not entries:
            return {"inserted": 0, "updated": 0, "total": 0}

        cur = self.connection.cursor()
        try:
            self.connection.autocommit = False
            cur.execute(
                """
                IF OBJECT_ID('tempdb..#divipola_stage') IS NOT NULL
                    DROP TABLE #divipola_stage;

                CREATE TABLE #divipola_stage (
                    cod_eleccion VARCHAR(20)  NOT NULL,
                    dep          VARCHAR(2)   NOT NULL,
                    nom_dep      VARCHAR(150) NOT NULL,
                    mun          VARCHAR(3)   NOT NULL,
                    nom_mun      VARCHAR(150) NOT NULL,
                    zz           VARCHAR(2)   NULL,
                    pp           VARCHAR(2)   NULL,
                    nom_puesto   VARCHAR(150) NULL
                );
                """
            )

            cur.fast_executemany = True
            insert_sql = """
                INSERT INTO #divipola_stage
                    (cod_eleccion, dep, nom_dep, mun, nom_mun, zz, pp, nom_puesto)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """
            for chunk_start in range(0, len(entries), _BATCH_SIZE):
                chunk = entries[chunk_start : chunk_start + _BATCH_SIZE]
                cur.executemany(
                    insert_sql,
                    [
                        (
                            e.cod_eleccion,
                            e.dep,
                            e.nom_dep,
                            e.mun,
                            e.nom_mun,
                            e.zz or None,
                            e.pp or None,
                            e.nom_puesto or None,
                        )
                        for e in chunk
                    ],
                )

            cur.execute(
                """
                SET NOCOUNT ON;
                DECLARE @actions TABLE (action_taken NVARCHAR(10));

                MERGE dbo.DIVIPOLA AS T
                USING #divipola_stage AS S
                   ON T.cod_eleccion = S.cod_eleccion
                  AND T.dep = S.dep
                  AND T.mun = S.mun
                  AND ISNULL(T.zz, '') = ISNULL(S.zz, '')
                  AND ISNULL(T.pp, '') = ISNULL(S.pp, '')
                WHEN MATCHED AND (
                       T.nom_dep <> S.nom_dep
                    OR T.nom_mun <> S.nom_mun
                    OR ISNULL(T.nom_puesto, '') <> ISNULL(S.nom_puesto, '')
                ) THEN UPDATE SET
                        nom_dep = S.nom_dep,
                        nom_mun = S.nom_mun,
                        nom_puesto = S.nom_puesto
                WHEN NOT MATCHED BY TARGET THEN
                    INSERT (cod_eleccion, dep, nom_dep, mun, nom_mun, zz, pp, nom_puesto)
                    VALUES (S.cod_eleccion, S.dep, S.nom_dep, S.mun, S.nom_mun, S.zz, S.pp, S.nom_puesto)
                OUTPUT $action INTO @actions;

                SELECT
                    SUM(CASE WHEN action_taken = 'INSERT' THEN 1 ELSE 0 END) AS inserted,
                    SUM(CASE WHEN action_taken = 'UPDATE' THEN 1 ELSE 0 END) AS updated
                FROM @actions;
                """
            )

            row = None
            while True:
                try:
                    row = cur.fetchone()
                    break
                except pyodbc.ProgrammingError:
                    if not cur.nextset():
                        break

            inserted = int(row.inserted or 0) if row else 0
            updated = int(row.updated or 0) if row else 0

            self.connection.commit()
            return {
                "inserted": inserted,
                "updated": updated,
                "total": inserted + updated,
            }
        except Exception:
            self.connection.rollback()
            logging.exception("[DivipolaSqlAdapter] bulk_upsert failed")
            raise
        finally:
            self.connection.autocommit = True

    def truncate(self) -> None:
        cur = self.connection.cursor()
        cur.execute("TRUNCATE TABLE dbo.DIVIPOLA;")
        self.connection.commit()

    def count(self) -> int:
        cur = self.connection.cursor()
        cur.execute("SELECT COUNT(*) FROM dbo.DIVIPOLA;")
        row = cur.fetchone()
        return int(row[0]) if row else 0
