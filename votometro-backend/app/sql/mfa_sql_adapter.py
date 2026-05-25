import base64
import hashlib
import hmac
import os
import secrets
import struct
import time
from datetime import datetime
from typing import Dict
from urllib.parse import quote

import pyodbc
from cryptography.fernet import Fernet
from pytz import timezone


def _make_connection() -> pyodbc.Connection:
    return pyodbc.connect(os.getenv("SQL_CONNECTION_STRING"))


def _fernet() -> Fernet:
    key_material = (
        os.getenv("MFA_ENCRYPTION_KEY")
        or os.getenv("MS_CLIENT_SECRET")
        or os.getenv("SQL_CONNECTION_STRING")
        or ""
    )
    if not key_material:
        raise RuntimeError("MFA encryption key material is not configured")
    key = base64.urlsafe_b64encode(hashlib.sha256(key_material.encode("utf-8")).digest())
    return Fernet(key)


def _normalize_code(code: str) -> str:
    return "".join(ch for ch in str(code or "") if ch.isdigit())


def _generate_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode("ascii").rstrip("=")


def _secret_bytes(secret: str) -> bytes:
    padded = secret + ("=" * ((8 - len(secret) % 8) % 8))
    return base64.b32decode(padded.upper())


def _totp(secret: str, timestamp: int | None = None, period: int = 30, digits: int = 6) -> str:
    timestamp = int(timestamp or time.time())
    counter = timestamp // period
    digest = hmac.new(_secret_bytes(secret), struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    return str(value % (10**digits)).zfill(digits)


def _verify_totp(secret: str, code: str, window: int = 2) -> bool:
    normalized = _normalize_code(code)
    if len(normalized) != 6:
        return False
    now = int(time.time())
    return any(
        hmac.compare_digest(_totp(secret, now + (offset * 30)), normalized)
        for offset in range(-window, window + 1)
    )


class MfaSqlAdapter:
    issuer = "Votometro"

    def __init__(self):
        self.connection = _make_connection()

    def get_status(self, user_id: str, session_token: str | None = None) -> Dict:
        cursor = self.connection.cursor()
        cursor.execute(
            """
            SELECT
                user_id,
                email,
                display_name,
                COALESCE(mfa_enabled, 0) AS mfa_enabled,
                mfa_enrolled_at,
                CASE WHEN mfa_secret_encrypted IS NULL THEN 0 ELSE 1 END AS has_secret
            FROM dbo.Users
            WHERE user_id = ?;
            """,
            user_id,
        )
        row = cursor.fetchone()
        if not row:
            raise LookupError("User not found")
        columns = [column[0] for column in cursor.description]
        status = dict(zip(columns, row))

        session_status = None
        mfa_verified = False
        if session_token:
            cursor.execute(
                """
                SELECT TOP 1 status, COALESCE(mfa_verified, 0) AS mfa_verified
                FROM dbo.UserSessions
                WHERE user_id = ? AND session_token = ?
                ORDER BY issued_at DESC;
                """,
                user_id,
                session_token,
            )
            session = cursor.fetchone()
            if session:
                session_status = session[0]
                mfa_verified = bool(session[1])

        return {
            "user_id": status["user_id"],
            "email": status["email"],
            "display_name": status["display_name"],
            "mfa_enabled": bool(status["mfa_enabled"]),
            "mfa_enrolled_at": self._format_datetime(status["mfa_enrolled_at"]),
            "has_secret": bool(status["has_secret"]),
            "session_status": session_status,
            "mfa_verified": mfa_verified,
            "mfa_required": not mfa_verified,
        }

    def mark_session_pending(self, user_id: str, session_token: str) -> None:
        cursor = self.connection.cursor()
        cursor.execute("EXEC dbo.MarkSessionMfaPending ?, ?", user_id, session_token)
        self.connection.commit()

    def start_setup(self, user_id: str) -> Dict:
        cursor = self.connection.cursor()
        cursor.execute(
            """
            SELECT email,
                   COALESCE(mfa_enabled, 0) AS mfa_enabled,
                   mfa_secret_encrypted
            FROM dbo.Users
            WHERE user_id = ?;
            """,
            user_id,
        )
        row = cursor.fetchone()
        if not row:
            raise LookupError("User not found")

        email = row[0]
        mfa_enabled = bool(row[1])
        encrypted_secret = row[2]

        if not mfa_enabled and encrypted_secret:
            secret = _fernet().decrypt(str(encrypted_secret).encode("utf-8")).decode("utf-8")
        else:
            secret = _generate_secret()
            encrypted = _fernet().encrypt(secret.encode("utf-8")).decode("utf-8")
            cursor.execute(
                """
                UPDATE dbo.Users
                   SET mfa_secret_encrypted = ?,
                       mfa_enabled = 0,
                       mfa_enrolled_at = NULL,
                       mfa_reset_at = SWITCHOFFSET(SYSDATETIMEOFFSET(), '-05:00')
                 WHERE user_id = ?;
                """,
                encrypted,
                user_id,
            )
            self.connection.commit()

        label = f"{self.issuer}:{email}"
        otpauth_uri = (
            "otpauth://totp/"
            f"{quote(label, safe=':')}?secret={secret}"
            f"&issuer={quote(self.issuer)}&algorithm=SHA1&digits=6&period=30"
        )
        return {
            "secret": secret,
            "otpauth_uri": otpauth_uri,
            "issuer": self.issuer,
            "account": email,
        }

    def verify_setup(self, user_id: str, session_token: str, code: str) -> Dict:
        secret = self._get_secret(user_id)
        if not _verify_totp(secret, code):
            raise PermissionError("Invalid MFA code")

        cursor = self.connection.cursor()
        now = datetime.now(timezone("America/Bogota"))
        cursor.execute(
            """
            UPDATE dbo.Users
               SET mfa_enabled = 1,
                   mfa_enrolled_at = ?,
                   mfa_reset_at = NULL
             WHERE user_id = ?;
            """,
            now,
            user_id,
        )
        self._mark_session_verified(cursor, user_id, session_token)
        self.connection.commit()
        return self.get_status(user_id, session_token)

    def verify_challenge(self, user_id: str, session_token: str, code: str) -> Dict:
        status = self.get_status(user_id, session_token)
        if not status["mfa_enabled"]:
            raise PermissionError("MFA setup required")
        secret = self._get_secret(user_id)
        if not _verify_totp(secret, code):
            raise PermissionError("Invalid MFA code")

        cursor = self.connection.cursor()
        self._mark_session_verified(cursor, user_id, session_token)
        self.connection.commit()
        return self.get_status(user_id, session_token)

    def reset_user_mfa(self, user_id: str) -> None:
        cursor = self.connection.cursor()
        cursor.execute(
            """
            UPDATE dbo.Users
               SET mfa_enabled = 0,
                   mfa_secret_encrypted = NULL,
                   mfa_enrolled_at = NULL,
                   mfa_reset_at = SWITCHOFFSET(SYSDATETIMEOFFSET(), '-05:00')
             WHERE user_id = ?;

            UPDATE dbo.UserSessions
               SET status = N'Closed',
                   is_active = 0,
                   mfa_verified = 0,
                   logout_time = COALESCE(logout_time, SWITCHOFFSET(SYSDATETIMEOFFSET(), '-05:00')),
                   updated_at = SWITCHOFFSET(SYSDATETIMEOFFSET(), '-05:00')
             WHERE user_id = ?
               AND is_active = 1;

            SELECT @@ROWCOUNT;
            """,
            user_id,
            user_id,
        )
        self.connection.commit()

    def _get_secret(self, user_id: str) -> str:
        cursor = self.connection.cursor()
        cursor.execute(
            "SELECT mfa_secret_encrypted FROM dbo.Users WHERE user_id = ?;",
            user_id,
        )
        row = cursor.fetchone()
        if not row:
            raise LookupError("User not found")
        if not row[0]:
            raise PermissionError("MFA setup required")
        return _fernet().decrypt(str(row[0]).encode("utf-8")).decode("utf-8")

    def _mark_session_verified(self, cursor, user_id: str, session_token: str) -> None:
        cursor.execute("EXEC dbo.MarkSessionMfaVerified ?, ?", user_id, session_token)
        row = cursor.fetchone()
        if not row or int(row[0] or 0) == 0:
            raise PermissionError("Session not found")

    def _format_datetime(self, value):
        if value is None:
            return None
        if hasattr(value, "strftime"):
            return value.strftime("%Y-%m-%d %H:%M:%S")
        return str(value)
