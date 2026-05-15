from datetime import datetime
from decimal import Decimal
import logging
import os
import uuid
from typing import Dict, List
import pyodbc
from pyodbc import Row
from pytz import timezone

from domain.repositories.session_sql_repository import ISessionSqlRepository


def _make_connection() -> pyodbc.Connection:
    """Abre una conexion pyodbc con encoding UTF-8 forzado."""
    cnxn = pyodbc.connect(os.getenv("SQL_CONNECTION_STRING"))
    try:
        cnxn.setdecoding(pyodbc.SQL_CHAR, encoding="utf-8")
        cnxn.setencoding(encoding="utf-8")
    except Exception as exc:
        logging.debug("[SessionSqlAdapter] setdecoding/setencoding: %s", exc)
    return cnxn


class SessionSqlAdapter(ISessionSqlRepository):
    def __init__(self):
        self.connection = _make_connection()

    def create_session(self, user_id, device_id, session_token, ipaddr, is_active, is_blocked):
        cursor = self.connection.cursor()
        cursor.execute(
            "EXEC CreateUserSession ?, ?, ?, ?, ?, ?, ?",
            user_id, device_id, session_token,
            datetime.now(timezone("America/Bogota")),
            ipaddr, is_active, is_blocked,
        )
        self.connection.commit()

    def invalidate_sessions(self, user_id: str, device_id: str) -> None:
        cursor = self.connection.cursor()
        cursor.execute("EXEC InvalidateUserSessions ?, ?", user_id, device_id)
        self.connection.commit()

    def invalidate_session_identifier(self, session_identifier: str) -> None:
        cursor = self.connection.cursor()
        cursor.execute(
            """
            DECLARE @Now DATETIME2 = SWITCHOFFSET(SYSDATETIMEOFFSET(), '-05:00');
            UPDATE dbo.UserSessions
            SET is_active = 0,
                status = CASE WHEN status = N'Expired_Idle' THEN status ELSE N'Closed' END,
                logout_time = COALESCE(logout_time, @Now),
                last_activity_time = COALESCE(last_activity_time, @Now),
                updated_at = @Now
            WHERE session_token = ?
               OR TRY_CONVERT(UNIQUEIDENTIFIER, ?) = session_id;
            """,
            session_identifier, session_identifier,
        )
        self.connection.commit()

    def revoke_session(self, session_id: str) -> None:
        cursor = self.connection.cursor()
        try:
            cursor.execute("EXEC dbo.RevokeUserSession ?", session_id)
            row = cursor.fetchone()
            self.connection.commit()
            if not row or int(row[0] or 0) == 0:
                raise LookupError("Session not found")
        except pyodbc.Error as error:
            self.connection.rollback()
            message = str(error)
            if "RevokeUserSession" not in message:
                raise
            cursor.execute(
                """
                DECLARE @Now DATETIME2 = SWITCHOFFSET(SYSDATETIMEOFFSET(), '-05:00');
                UPDATE dbo.UserSessions
                SET is_active = 0,
                    status = N'Revoked_by_Admin',
                    logout_time = @Now,
                    last_activity_time = COALESCE(last_activity_time, @Now),
                    updated_at = @Now
                WHERE session_id = TRY_CONVERT(UNIQUEIDENTIFIER, ?);
                SELECT @@ROWCOUNT AS affected_rows;
                """,
                session_id,
            )
            row = cursor.fetchone()
            self.connection.commit()
            if not row or int(row[0] or 0) == 0:
                raise LookupError("Session not found")

    def get_session_status(self, user_id: str, session_token: str) -> Dict | None:
        cursor = self.connection.cursor()
        cursor.execute(
            """
            SELECT TOP 1
                session_id, user_id, session_token,
                is_active, is_blocked, status, logout_time
            FROM dbo.UserSessions
            WHERE user_id = ? AND session_token = ?
            ORDER BY issued_at DESC;
            """,
            user_id, session_token,
        )
        row = cursor.fetchone()
        if not row:
            return None
        columns = [column[0] for column in cursor.description]
        return self._serialize_row(dict(zip(columns, row)))

    def get_active_session(self, user_id: str, device_id: str) -> Dict | None:
        cursor = self.connection.cursor()
        cursor.execute("EXEC GetActiveSessionByUserId ?, ?", user_id, device_id)
        row = cursor.fetchone()
        if row:
            columns = [column[0] for column in cursor.description]
            return self._serialize_row(dict(zip(columns, row)))
        return None

    def get_device_from_session(self, session_id) -> Row:
        cursor = self.connection.cursor()
        cursor.execute("EXEC GetDeviceIdBySessionId ?", session_id)
        return cursor.fetchone()

    def get_users_sessions_info(self) -> List[Dict]:
        cursor = self.connection.cursor()
        cursor.execute("EXEC GetUserSessionsInfo ")
        columns = [column[0] for column in cursor.description]
        return [self._serialize_row(dict(zip(columns, row))) for row in cursor.fetchall()]

    def get_session_activity_detail(self, session_id: str) -> Dict:
        cursor = self.connection.cursor()
        try:
            cursor.execute("EXEC dbo.GetSessionActivityDetail ?", session_id)
            session = self._read_session_activity_result_sets(cursor)
            if session is None:
                raise LookupError("Session not found")
            return session
        except pyodbc.Error as error:
            message = str(error)
            if "GetSessionActivityDetail" not in message:
                raise
            # Fallback: SP no existe -> SQL directo
            logging.warning(
                "[SessionSqlAdapter] SP GetSessionActivityDetail no existe, "
                "usando fallback SQL para session_id=%s", session_id
            )
            cursor.execute(
                """
                SELECT
                    us.session_id,
                    u.user_id,
                    u.email,
                    u.display_name,
                    us.ip_address,
                    us.status,
                    us.is_active,
                    us.is_blocked,
                    us.issued_at,
                    us.login_time,
                    us.last_activity_time,
                    us.logout_time,
                    DATEDIFF(
                        SECOND,
                        COALESCE(us.login_time, us.issued_at, us.created_at),
                        COALESCE(us.logout_time, us.last_activity_time, us.updated_at)
                    ) AS total_seconds
                FROM dbo.UserSessions us
                INNER JOIN dbo.Users u ON us.user_id = u.user_id
                WHERE us.session_id = TRY_CONVERT(UNIQUEIDENTIFIER, ?);
                """,
                session_id,
            )
            session_row = cursor.fetchone()
            if not session_row:
                raise LookupError("Session not found")
            session_columns = [column[0] for column in cursor.description]
            session = self._serialize_row(dict(zip(session_columns, session_row)))

            try:
                cursor.execute(
                    """
                    SELECT
                        l.log_id,
                        l.page_route,
                        l.time_spent_seconds,
                        l.created_at
                    FROM dbo.Session_Navigation_Logs l
                    WHERE l.session_id = TRY_CONVERT(UNIQUEIDENTIFIER, ?)
                    ORDER BY l.created_at ASC, l.log_id ASC;
                    """,
                    session_id,
                )
                page_columns = [column[0] for column in cursor.description]
                session["pages"] = [
                    self._serialize_row(dict(zip(page_columns, r)))
                    for r in cursor.fetchall()
                ]
            except pyodbc.Error as page_err:
                logging.warning(
                    "[SessionSqlAdapter] No se pudo leer Session_Navigation_Logs: %s", page_err
                )
                session["pages"] = []

            return session

    def _read_session_activity_result_sets(self, cursor) -> Dict | None:
        while cursor.description is None:
            if not cursor.nextset():
                return None
        session_row = cursor.fetchone()
        if not session_row:
            return None
        session_columns = [column[0] for column in cursor.description]
        session = self._serialize_row(dict(zip(session_columns, session_row)))
        pages = []
        while cursor.nextset():
            if cursor.description is None:
                continue
            page_columns = [column[0] for column in cursor.description]
            pages = [
                self._serialize_row(dict(zip(page_columns, row)))
                for row in cursor.fetchall()
            ]
            break
        session["pages"] = pages
        return session

    def invalidate_all_sessions(self, user_id: str) -> None:
        cursor = self.connection.cursor()
        cursor.execute("EXEC InvalidateAllUserSessions ?", user_id)
        self.connection.commit()

    def record_heartbeat(
        self,
        user_id: str,
        session_token: str,
        pages: List[Dict],
        idle_timeout_seconds: int = 7200,
    ) -> Dict:
        cursor = self.connection.cursor()
        committed = False
        try:
            cursor.execute(
                """
                DECLARE @Now DATETIME2 = SWITCHOFFSET(SYSDATETIMEOFFSET(), '-05:00');
                SELECT TOP 1
                    session_id, is_active, is_blocked, status,
                    DATEDIFF(SECOND, COALESCE(last_activity_time, issued_at, created_at), @Now) AS idle_seconds
                FROM dbo.UserSessions WITH (UPDLOCK, ROWLOCK)
                WHERE user_id = ? AND session_token = ?
                ORDER BY issued_at DESC;
                """,
                user_id, session_token,
            )
            row = cursor.fetchone()
            if not row:
                raise PermissionError("Session not found")

            columns = [column[0] for column in cursor.description]
            session = dict(zip(columns, row))
            session_id = session["session_id"]
            idle_seconds = int(session.get("idle_seconds") or 0)

            if not session.get("is_active") or session.get("is_blocked"):
                if session.get("status") == "Revoked_by_Admin":
                    raise PermissionError("SESSION_REVOKED")
                raise PermissionError("Session is not active")

            if idle_seconds > idle_timeout_seconds:
                cursor.execute(
                    """
                    DECLARE @Now DATETIME2 = SWITCHOFFSET(SYSDATETIMEOFFSET(), '-05:00');
                    UPDATE dbo.UserSessions
                    SET is_active = 0, status = N'Expired_Idle',
                        logout_time = @Now, updated_at = @Now
                    WHERE session_id = ?;
                    """,
                    session_id,
                )
                self.connection.commit()
                committed = True
                raise PermissionError("Session Expired")

            cursor.execute(
                """
                DECLARE @Now DATETIME2 = SWITCHOFFSET(SYSDATETIMEOFFSET(), '-05:00');
                UPDATE dbo.UserSessions
                SET last_activity_time = @Now, updated_at = @Now,
                    status = N'Active', is_active = 1
                WHERE session_id = ?;
                """,
                session_id,
            )

            inserted = 0
            for page in pages:
                route = str(page.get("route") or "").strip()[:512]
                seconds = int(page.get("seconds") or 0)
                if not route or seconds <= 0:
                    continue
                cursor.execute(
                    """
                    INSERT INTO dbo.Session_Navigation_Logs
                        (session_id, page_route, time_spent_seconds, created_at)
                    VALUES (?, ?, ?, SWITCHOFFSET(SYSDATETIMEOFFSET(), '-05:00'));
                    """,
                    session_id, route, seconds,
                )
                inserted += 1

            self.connection.commit()
            committed = True
            return {
                "session_id": str(session_id),
                "idle_seconds": idle_seconds,
                "inserted_logs": inserted,
                "status": "Active",
            }
        except PermissionError:
            if not committed:
                self.connection.rollback()
            raise
        except Exception:
            self.connection.rollback()
            raise

    def _serialize_row(self, row: Dict) -> Dict:
        """Convierte tipos no-JSON-serializables a primitivos Python.

        Cubre: datetime, Decimal, uuid.UUID, bytes y cualquier otro tipo
        exotico que pyodbc pueda devolver desde SQL Server.
        """
        for key, value in list(row.items()):
            if value is None:
                continue
            if hasattr(value, "strftime"):           # datetime / date
                row[key] = value.strftime("%Y-%m-%d %H:%M:%S")
            elif isinstance(value, Decimal):         # DECIMAL / NUMERIC
                row[key] = float(value)
            elif isinstance(value, uuid.UUID):       # UNIQUEIDENTIFIER
                row[key] = str(value)
            elif isinstance(value, (bytes, bytearray)):
                row[key] = value.hex()
            elif not isinstance(value, (str, int, float, bool)):
                row[key] = str(value)                # fallback seguro
        return row
