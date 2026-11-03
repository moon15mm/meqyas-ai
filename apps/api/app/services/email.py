"""E-mail delivery behind a tiny interface.

Development: messages are written to the API log (no external service).
Production: set SMTP_URL, e.g. ``smtp://user:pass@smtp.example.com:587?starttls=true``.
"""

from __future__ import annotations

import asyncio
import logging
import smtplib
from email.message import EmailMessage
from urllib.parse import parse_qs, unquote, urlparse

from ..core.config import get_settings

logger = logging.getLogger("meqyas.email")


async def send_email(to: str, subject: str, body: str) -> None:
    s = get_settings()
    if not s.smtp_url:
        if s.is_production:
            logger.error("SMTP_URL is not configured — e-mail to a user was NOT sent (subject=%s)", subject)
            return
        logger.warning("DEV EMAIL (not sent) → subject: %s\n%s", subject, body)
        return
    await asyncio.to_thread(_send_smtp, s.smtp_url, s.email_from, to, subject, body)


def _send_smtp(url: str, sender: str, to: str, subject: str, body: str) -> None:
    parsed = urlparse(url)
    params = parse_qs(parsed.query)
    msg = EmailMessage()
    msg["From"] = sender
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    port = parsed.port or (465 if parsed.scheme == "smtps" else 587)
    if parsed.scheme == "smtps":
        server: smtplib.SMTP = smtplib.SMTP_SSL(parsed.hostname or "localhost", port, timeout=15)
    else:
        server = smtplib.SMTP(parsed.hostname or "localhost", port, timeout=15)
    with server:
        if params.get("starttls", ["true"])[0].lower() == "true" and parsed.scheme != "smtps":
            server.starttls()
        if parsed.username:
            server.login(unquote(parsed.username), unquote(parsed.password or ""))
        server.send_message(msg)
