"""Servicio de envío de correos electrónicos — Votómetro / Audivoto.

Módulo responsable de:
  · Renderizar la plantilla HTML de bienvenida (shared/templates/welcome_email.html).
  · Enviar el correo vía SMTP con autenticación TLS.

Variables de entorno requeridas:
  SMTP_HOST     — servidor SMTP (ej: smtp.office365.com, smtp.gmail.com)
  SMTP_PORT     — puerto SMTP (587 para STARTTLS, 465 para SSL)
  SMTP_USER     — usuario/remitente (ej: noreply@ingenial-ia.com)
  SMTP_PASS     — contraseña o App Password del remitente
  SMTP_FROM_NAME — nombre visible del remitente (ej: "Ingenial IA - Votómetro")
  FRONTEND_URL  — URL base del frontend (ej: https://votometro.ingenial-ia.com)

Uso:
    from shared.email_service import send_welcome_email

    send_welcome_email(
        personal_email="usuario@gmail.com",
        context={
            "display_name":        "María López",
            "institutional_email": "m.lopez@ingenial-ia.com",
            "password":            "Xk9#mP2qR",
            "datetime":            "2026-05-15 10:34:22 (COT)",
        }
    )
"""

from __future__ import annotations

import logging
import os
import smtplib
import ssl
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path
from typing import Any, Dict

logger = logging.getLogger(__name__)

# ──────────────────────────────────────────────────────────────────────────
# Ruta de la plantilla HTML (relativa a este módulo)
# ──────────────────────────────────────────────────────────────────────────
_TEMPLATE_PATH = Path(__file__).parent / "templates" / "welcome_email.html"


# ──────────────────────────────────────────────────────────────────────────
# Helpers internos
# ──────────────────────────────────────────────────────────────────────────

def _load_template() -> str:
    """Carga la plantilla HTML desde disco.

    Raises:
        FileNotFoundError: Si el archivo no existe en la ruta esperada.
    """
    if not _TEMPLATE_PATH.exists():
        raise FileNotFoundError(
            f"Plantilla de correo no encontrada: {_TEMPLATE_PATH}"
        )
    return _TEMPLATE_PATH.read_text(encoding="utf-8")


def _render_template(template: str, context: Dict[str, Any]) -> str:
    """Sustituye las variables {{key}} en la plantilla con los valores del contexto.

    Solo reemplaza variables declaradas en `context`. Variables no presentes
    en el contexto se dejan intactas para facilitar el debugging.

    Args:
        template: Contenido HTML con marcadores {{key}}.
        context:  Dict con los valores a inyectar.

    Returns:
        HTML con todas las variables sustituidas.
    """
    rendered = template
    for key, value in context.items():
        rendered = rendered.replace(f"{{{{{key}}}}}", str(value) if value is not None else "")
    return rendered


def _build_message(
    to_address: str,
    subject: str,
    html_body: str,
    from_address: str,
    from_name: str,
) -> MIMEMultipart:
    """Construye el objeto MIME multipart (text/plain + text/html).

    El fallback en texto plano es esencial para clientes que no renderan HTML.

    Args:
        to_address:   Destinatario.
        subject:      Asunto del correo.
        html_body:    Cuerpo HTML completo ya renderado.
        from_address: Dirección del remitente.
        from_name:    Nombre visible del remitente.

    Returns:
        MIMEMultipart listo para enviar.
    """
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = f"{from_name} <{from_address}>"
    msg["To"]      = to_address
    msg["X-Priority"] = "1"  # Marcar como importante
    msg["X-Mailer"]   = "Votómetro Platform / Ingenial IA"

    # Parte 1: texto plano (fallback accesible)
    plain_text = (
        f"Bienvenido a Votómetro / Audivoto\n\n"
        f"Tu cuenta ha sido creada exitosamente.\n\n"
        f"Correo institucional: {_extract_value(html_body, 'institutional_email')}\n"
        f"Contraseña temporal: (ver versión HTML)\n\n"
        f"Por seguridad, se te pedirá cambiar la contraseña en tu primer inicio de sesión.\n\n"
        f"Accede a la plataforma en: {_extract_value(html_body, 'login_url')}\n\n"
        f"© 2026 Ingenial IA"
    )
    msg.attach(MIMEText(plain_text, "plain", "utf-8"))

    # Parte 2: HTML (preferido por los clientes modernos)
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    return msg


def _extract_value(html: str, key: str) -> str:
    """Extrae el valor de una variable ya renderada del HTML (best-effort).

    No se usa para el envío — solo para el fallback en texto plano.
    """
    # Las variables ya están sustituidas, así que no hay {{key}} que parsear.
    # Devolvemos un placeholder genérico en su lugar.
    return "(ver correo HTML)"


def _get_smtp_config() -> Dict[str, Any]:
    """Lee y valida la configuración SMTP desde variables de entorno.

    Returns:
        Dict con host, port, user, password, from_name.

    Raises:
        EnvironmentError: Si alguna variable requerida está ausente.
    """
    required = {
        "SMTP_HOST": os.getenv("SMTP_HOST"),
        "SMTP_PORT": os.getenv("SMTP_PORT"),
        "SMTP_USER": os.getenv("SMTP_USER"),
        "SMTP_PASS": os.getenv("SMTP_PASS"),
    }
    missing = [k for k, v in required.items() if not v]
    if missing:
        raise EnvironmentError(
            f"Variables de entorno SMTP faltantes: {', '.join(missing)}. "
            "El correo de bienvenida no puede enviarse."
        )

    return {
        "host":      required["SMTP_HOST"],
        "port":      int(required["SMTP_PORT"]),
        "user":      required["SMTP_USER"],
        "password":  required["SMTP_PASS"],
        "from_name": os.getenv("SMTP_FROM_NAME", "Ingenial IA · Votómetro"),
    }


# ──────────────────────────────────────────────────────────────────────────
# API pública
# ──────────────────────────────────────────────────────────────────────────

def send_welcome_email(personal_email: str, context: Dict[str, Any]) -> bool:
    """Envía el correo de bienvenida al correo personal del usuario.

    El flujo NO lanza excepción hacia el caller en caso de error — simplemente
    registra el fallo en el log. Esto evita que un problema SMTP tumbe la
    creación del usuario.

    Args:
        personal_email: Dirección personal del destinatario.
        context: Dict con las variables a inyectar en la plantilla:
            - display_name        (str) Nombre completo del usuario.
            - institutional_email (str) Correo institucional creado.
            - password            (str) Contraseña temporal generada.
            - login_url           (str) URL de acceso a la plataforma.
            - datetime            (str) Fecha/hora de registro (COT).

    Returns:
        True si el envío fue exitoso, False en caso de error.
    """
    if not personal_email or "@" not in personal_email:
        logger.warning(
            "[EmailService] Correo personal ausente o inválido ('%s'). "
            "Se omite el envío del welcome email.",
            personal_email,
        )
        return False

    # Añadir login_url al contexto si no viene
    if "login_url" not in context:
        context["login_url"] = os.getenv(
            "FRONTEND_URL", "http://localhost:8080"
        )

    try:
        smtp_cfg  = _get_smtp_config()
        template  = _load_template()
        html_body = _render_template(template, context)
        message   = _build_message(
            to_address   = personal_email,
            subject      = "🗳️ Bienvenido a Votómetro / Audivoto — Tus credenciales de acceso",
            html_body    = html_body,
            from_address = smtp_cfg["user"],
            from_name    = smtp_cfg["from_name"],
        )
    except (FileNotFoundError, EnvironmentError) as config_error:
        logger.error(
            "[EmailService] Error de configuración — no se enviará el correo: %s",
            config_error,
        )
        return False
    except Exception as render_error:
        logger.exception(
            "[EmailService] Error al preparar el correo para '%s': %s",
            personal_email, render_error,
        )
        return False

    # ── Envío SMTP ─────────────────────────────────────────────────────────
    port = smtp_cfg["port"]
    try:
        if port == 465:
            # SSL directo (puerto 465)
            context_ssl = ssl.create_default_context()
            with smtplib.SMTP_SSL(smtp_cfg["host"], port, context=context_ssl,
                                  timeout=15) as server:
                server.login(smtp_cfg["user"], smtp_cfg["password"])
                server.sendmail(
                    smtp_cfg["user"],
                    [personal_email],
                    message.as_bytes(linesep=b"\r\n"),
                )
        else:
            # STARTTLS (puerto 587 o 25)
            with smtplib.SMTP(smtp_cfg["host"], port, timeout=15) as server:
                server.ehlo()
                server.starttls(context=ssl.create_default_context())
                server.ehlo()
                server.login(smtp_cfg["user"], smtp_cfg["password"])
                server.sendmail(
                    smtp_cfg["user"],
                    [personal_email],
                    message.as_bytes(linesep=b"\r\n"),
                )

        logger.info(
            "[EmailService] Correo de bienvenida enviado exitosamente a '%s'.",
            personal_email,
        )
        return True

    except smtplib.SMTPAuthenticationError:
        logger.error(
            "[EmailService] Autenticación SMTP fallida. "
            "Verificar SMTP_USER y SMTP_PASS en las variables de entorno."
        )
    except smtplib.SMTPRecipientsRefused:
        logger.error(
            "[EmailService] El destinatario '%s' fue rechazado por el servidor SMTP.",
            personal_email,
        )
    except smtplib.SMTPConnectError:
        logger.error(
            "[EmailService] No se pudo conectar a %s:%d. "
            "Verificar SMTP_HOST y SMTP_PORT.",
            smtp_cfg["host"], port,
        )
    except TimeoutError:
        logger.error(
            "[EmailService] Timeout al conectar con el servidor SMTP (%s:%d).",
            smtp_cfg["host"], port,
        )
    except Exception as smtp_error:
        logger.exception(
            "[EmailService] Error inesperado al enviar correo a '%s': %s",
            personal_email, smtp_error,
        )

    return False
