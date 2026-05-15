import os
from typing import List
import pyodbc
from domain.models.department import Department
from domain.repositories.department_sql_repository import IDepartmentSqlRepository


class DepartmentSqlAdapter(IDepartmentSqlRepository):
    def __init__(self):
        self.connection = pyodbc.connect(os.getenv("SQL_CONNECTION_STRING"))

    def list_departments(self) -> List[Department]:
        cursor = self.connection.cursor()
        cursor.execute(
            """
            SELECT DISTINCT
                dep AS code,
                nom_dep AS name
            FROM dbo.DIVIPOLA
            ORDER BY nom_dep;
            """
        )
        rows = cursor.fetchall()

        departments = []
        for row in rows:
            department = Department(
                code=str(row.code).strip(),
                name=str(row.name).strip(),
            )

            departments.append(department.__dict__)
        return departments
