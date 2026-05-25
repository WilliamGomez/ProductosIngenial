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

    def _close_existing_user_sessions(self, cursor: pyodbc.Cursor, user_id: str) -> None:
        cursor.execute(
            """
            DECLARE @Now DATETIME2 = SWITCHOFFSET(SYSDATETIMEOFFSET(), '-05:00');

            UPDATE dbo.UserSessions
            SET is_active = 0,
                is_blocked = 0,
                status = CASE WHEN status = N'Expired_Idle' THEN status ELSE N'Closed' END,
                logout_time = COALESCE(logout_time, @Now),
                last_activity_time = COALESCE(last_activity_time, @Now),
                updated_at = @Now
            WHERE user_id = ?
              AND is_active = 1;
            """,
            user_id,
        )

    def _expire_idle_sessions(self, cursor: pyodbc.Cursor, idle_timeout_seconds: int = 7200) -> None:
        cursor.execute(
            """
            DECLARE @Now DATETIME2 = SWITCHOFFSET(SYSDATETIMEOFFSET(), '-05:00');
            DECLARE @IdleSeconds INT = ?;

            UPDATE dbo.UserSessions
            SET is_active = 0,
                status = N'Expired_Idle',
                logout_time = COALESCE(
                    logout_time,
                    DATEADD(SECOND, @IdleSeconds, COALESCE(last_activity_time, issued_at, created_at))
                ),
                updated_at = @Now
            WHERE is_active = 1
              AND COALESCE(status, N'Active') = N'Active'
              AND DATEDIFF(SECOND, COALESCE(last_activity_time, issued_at, created_at), @Now) > @IdleSeconds;
            """,
            idle_timeout_seconds,
        )
        self.connection.commit()

    def create_session(
        self,
        user_id,
        device_id,
        session_token,
        ipaddr,
        is_active,
        is_blocked,
        user_agent=None,
    ):
        cursor = self.connection.cursor()
        try:
            self._close_existing_user_sessions(cursor, user_id)
            cursor.execute(
                "EXEC CreateUserSession ?, ?, ?, ?, ?, ?, ?, ?",
                user_id, device_id, session_token,
                datetime.now(timezone("America/Bogota")),
                ipaddr, is_active, is_blocked, user_agent,
            )
            self.connection.commit()
        except pyodbc.Error as error:
            self.connection.rollback()
            message = str(error)
            if "too many arguments" not in message.lower() and "expects parameter" not in message.lower():
                raise
            self._close_existing_user_sessions(cursor, user_id)
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
        self._expire_idle_sessions(cursor)
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
        self._expire_idle_sessions(cursor)
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
        self._expire_idle_sessions(cursor)
        cursor.execute("EXEC GetUserSessionsInfo ")
        columns = [column[0] for column in cursor.description]
        return [self._serialize_row(dict(zip(columns, row))) for row in cursor.fetchall()]

    def get_session_activity_detail(self, session_id: str) -> Dict:
        cursor = self.connection.cursor()
        self._expire_idle_sessions(cursor)
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
                        MIN(l.log_id) AS log_id,
                        l.page_route,
                        SUM(l.time_spent_seconds) AS time_spent_seconds,
                        MIN(l.created_at) AS created_at
                    FROM dbo.Session_Navigation_Logs l
                    WHERE l.session_id = TRY_CONVERT(UNIQUEIDENTIFIER, ?)
                    GROUP BY l.page_route
                    ORDER BY SUM(l.time_spent_seconds) DESC, MIN(l.created_at) ASC;
                    """,
                    session_id,
                )
                page_columns = [column[0] for column in cursor.description]
                session["pages"] = self._aggregate_session_pages([
                    self._serialize_row(dict(zip(page_columns, r)))
                    for r in cursor.fetchall()
                ])
            except pyodbc.Error as page_err:
                logging.warning(
                    "[SessionSqlAdapter] No se pudo leer Session_Navigation_Logs: %s", page_err
                )
                session["pages"] = []

            return session

    def get_session_analytics(self, days: int = 30) -> Dict:
        days = max(1, min(int(days or 30), 365))
        cursor = self.connection.cursor()
        self._expire_idle_sessions(cursor)

        cursor.execute(
            "SELECT CASE WHEN COL_LENGTH('dbo.UserSessions', 'user_agent') IS NULL THEN 0 ELSE 1 END"
        )
        has_user_agent = bool(cursor.fetchone()[0])
        user_agent_select = "us.user_agent" if has_user_agent else "CAST(NULL AS NVARCHAR(512)) AS user_agent"

        base_cte = f"""
            DECLARE @Since DATETIME2 = DATEADD(DAY, -1 * ?, SWITCHOFFSET(SYSDATETIMEOFFSET(), '-05:00'));

            WITH session_base AS (
                SELECT
                    us.session_id,
                    us.user_id,
                    u.email,
                    u.display_name,
                    us.ip_address,
                    us.status,
                    us.is_active,
                    us.issued_at,
                    us.login_time,
                    us.last_activity_time,
                    us.logout_time,
                    {user_agent_select}
                FROM dbo.UserSessions us
                INNER JOIN dbo.Users u ON u.user_id = us.user_id
                WHERE COALESCE(us.login_time, us.issued_at, us.created_at) >= @Since
            ),
            nav AS (
                SELECT
                    l.session_id,
                    l.page_route,
                    l.time_spent_seconds,
                    l.created_at,
                    CASE
                        WHEN LOWER(l.page_route) LIKE N'%votometro%' THEN N'Votometro'
                        WHEN LOWER(l.page_route) LIKE N'%audivoto%' THEN N'Audivoto'
                        ELSE N'Otros'
                    END AS product_name,
                    CASE
                        WHEN CHARINDEX(N'/', STUFF(l.page_route, 1, 1, N'')) > 0
                            THEN RIGHT(l.page_route, LEN(l.page_route) - CHARINDEX(N'/', l.page_route, 2))
                        ELSE l.page_route
                    END AS report_area
                FROM dbo.Session_Navigation_Logs l
                INNER JOIN session_base sb ON sb.session_id = l.session_id
            ),
            session_seconds AS (
                SELECT session_id, SUM(time_spent_seconds) AS tracked_seconds
                FROM nav
                GROUP BY session_id
            )
        """

        def fetch_all(query: str, *params) -> List[Dict]:
            cursor.execute(base_cte + query, days, *params)
            columns = [column[0] for column in cursor.description]
            return [self._serialize_row(dict(zip(columns, row))) for row in cursor.fetchall()]

        summary = fetch_all(
            """
            SELECT
                COUNT(DISTINCT sb.session_id) AS total_sessions,
                COUNT(DISTINCT sb.user_id) AS total_users,
                SUM(CASE WHEN sb.is_active = 1 THEN 1 ELSE 0 END) AS active_sessions,
                SUM(CASE WHEN sb.status = N'Expired_Idle' THEN 1 ELSE 0 END) AS expired_sessions,
                COALESCE(SUM(ss.tracked_seconds), 0) AS tracked_seconds,
                COALESCE(AVG(CAST(ss.tracked_seconds AS FLOAT)), 0) AS avg_tracked_seconds
            FROM session_base sb
            LEFT JOIN session_seconds ss ON ss.session_id = sb.session_id;
            """
        )[0]

        return {
            "days": days,
            "summary": summary,
            "top_users": fetch_all(
                """
                SELECT TOP 15
                    sb.user_id,
                    sb.email,
                    sb.display_name,
                    COUNT(DISTINCT sb.session_id) AS sessions,
                    COALESCE(SUM(ss.tracked_seconds), 0) AS total_seconds,
                    MAX(COALESCE(sb.last_activity_time, sb.issued_at)) AS last_activity_time
                FROM session_base sb
                LEFT JOIN session_seconds ss ON ss.session_id = sb.session_id
                GROUP BY sb.user_id, sb.email, sb.display_name
                ORDER BY COALESCE(SUM(ss.tracked_seconds), 0) DESC, COUNT(DISTINCT sb.session_id) DESC;
                """
            ),
            "top_routes": fetch_all(
                """
                SELECT TOP 20
                    product_name,
                    report_area,
                    page_route,
                    SUM(time_spent_seconds) AS total_seconds,
                    COUNT(*) AS events,
                    COUNT(DISTINCT session_id) AS sessions
                FROM nav
                GROUP BY product_name, report_area, page_route
                ORDER BY SUM(time_spent_seconds) DESC;
                """
            ),
            "by_date": fetch_all(
                """
                SELECT
                    CONVERT(VARCHAR(10), CAST(created_at AS DATE), 23) AS date,
                    SUM(time_spent_seconds) AS total_seconds,
                    COUNT(DISTINCT session_id) AS sessions,
                    COUNT(*) AS events
                FROM nav
                GROUP BY CAST(created_at AS DATE)
                ORDER BY CAST(created_at AS DATE);
                """
            ),
            "by_hour": fetch_all(
                """
                SELECT
                    DATEPART(HOUR, created_at) AS hour,
                    SUM(time_spent_seconds) AS total_seconds,
                    COUNT(DISTINCT session_id) AS sessions,
                    COUNT(*) AS events
                FROM nav
                GROUP BY DATEPART(HOUR, created_at)
                ORDER BY DATEPART(HOUR, created_at);
                """
            ),
            "by_product": fetch_all(
                """
                SELECT
                    product_name,
                    SUM(time_spent_seconds) AS total_seconds,
                    COUNT(DISTINCT session_id) AS sessions,
                    COUNT(*) AS events
                FROM nav
                GROUP BY product_name
                ORDER BY SUM(time_spent_seconds) DESC;
                """
            ),
            "browsers": fetch_all(
                """
                SELECT
                    CASE
                        WHEN user_agent IS NULL OR LTRIM(RTRIM(user_agent)) = N'' THEN N'No registrado'
                        WHEN user_agent LIKE N'%Edg/%' THEN N'Microsoft Edge'
                        WHEN user_agent LIKE N'%OPR/%' OR user_agent LIKE N'%Opera%' THEN N'Opera'
                        WHEN user_agent LIKE N'%Firefox/%' THEN N'Firefox'
                        WHEN user_agent LIKE N'%Chrome/%' THEN N'Chrome'
                        WHEN user_agent LIKE N'%Safari/%' THEN N'Safari'
                        ELSE N'Otro'
                    END AS browser,
                    COUNT(DISTINCT session_id) AS sessions,
                    COUNT(DISTINCT user_id) AS users
                FROM session_base
                GROUP BY
                    CASE
                        WHEN user_agent IS NULL OR LTRIM(RTRIM(user_agent)) = N'' THEN N'No registrado'
                        WHEN user_agent LIKE N'%Edg/%' THEN N'Microsoft Edge'
                        WHEN user_agent LIKE N'%OPR/%' OR user_agent LIKE N'%Opera%' THEN N'Opera'
                        WHEN user_agent LIKE N'%Firefox/%' THEN N'Firefox'
                        WHEN user_agent LIKE N'%Chrome/%' THEN N'Chrome'
                        WHEN user_agent LIKE N'%Safari/%' THEN N'Safari'
                        ELSE N'Otro'
                    END
                ORDER BY COUNT(DISTINCT session_id) DESC;
                """
            ),
            "recent_sessions": fetch_all(
                """
                SELECT TOP 20
                    sb.session_id,
                    sb.user_id,
                    sb.email,
                    sb.display_name,
                    sb.ip_address,
                    sb.status,
                    sb.is_active,
                    sb.issued_at,
                    sb.last_activity_time,
                    COALESCE(ss.tracked_seconds, 0) AS tracked_seconds
                FROM session_base sb
                LEFT JOIN session_seconds ss ON ss.session_id = sb.session_id
                ORDER BY COALESCE(sb.last_activity_time, sb.issued_at) DESC;
                """
            ),
            "has_user_agent": has_user_agent,
        }

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
        session["pages"] = self._aggregate_session_pages(pages)
        return session

    def _aggregate_session_pages(self, pages: List[Dict]) -> List[Dict]:
        grouped: Dict[str, Dict] = {}
        for page in pages:
            route = str(page.get("page_route") or "").strip()
            if not route:
                continue
            seconds = int(page.get("time_spent_seconds") or 0)
            if route not in grouped:
                grouped[route] = {
                    **page,
                    "page_route": route,
                    "time_spent_seconds": seconds,
                }
                continue
            grouped[route]["time_spent_seconds"] += seconds
            current_log_id = grouped[route].get("log_id")
            incoming_log_id = page.get("log_id")
            if incoming_log_id is not None and (
                current_log_id is None or incoming_log_id < current_log_id
            ):
                grouped[route]["log_id"] = incoming_log_id
            current_created_at = grouped[route].get("created_at")
            incoming_created_at = page.get("created_at")
            if incoming_created_at and (
                not current_created_at or incoming_created_at < current_created_at
            ):
                grouped[route]["created_at"] = incoming_created_at
        return sorted(
            grouped.values(),
            key=lambda item: (-int(item.get("time_spent_seconds") or 0), item.get("created_at") or ""),
        )

    def invalidate_all_sessions(self, user_id: str) -> None:
        cursor = self.connection.cursor()
        try:
            cursor.execute("EXEC InvalidateAllUserSessions ?", user_id)
            self.connection.commit()
        except pyodbc.Error as error:
            self.connection.rollback()
            message = str(error)
            if "InvalidateAllUserSessions" not in message:
                raise
            self._close_existing_user_sessions(cursor, user_id)
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
            self._expire_idle_sessions(cursor, idle_timeout_seconds)
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

            if session.get("status") != "Active":
                raise PermissionError("MFA_REQUIRED")

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
                route = str(page.get("route") or page.get("page_route") or "").strip()[:255]
                seconds = min(int(page.get("seconds") or page.get("time_spent_seconds") or 0), idle_timeout_seconds)
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
