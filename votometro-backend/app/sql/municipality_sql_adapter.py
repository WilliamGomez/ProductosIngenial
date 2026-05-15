import os
from typing import List
import pyodbc
from domain.models.municipality import Municipality
from domain.repositories.municipality_sql_repository import IMunicipalitySqlRepository


class MunicipalitySqlAdapter(IMunicipalitySqlRepository):
    def __init__(self):
        self.connection = pyodbc.connect(os.getenv("SQL_CONNECTION_STRING"))

    def list_municipalities(self) -> List[Municipality]:
        cursor = self.connection.cursor()
        cursor.execute(
            """
            SELECT DISTINCT
                (dep + mun) AS code,
                nom_mun AS name,
                dep AS dpto
            FROM dbo.DIVIPOLA
            ORDER BY nom_mun;
            """
        )
        rows = cursor.fetchall()

        municipalities = []
        for row in rows:
            municipality = Municipality(
                code=str(row.code).strip(),
                name=str(row.name).strip(),
                dpto=str(row.dpto).strip(),
            )

            municipalities.append(municipality.__dict__)
        return municipalities
