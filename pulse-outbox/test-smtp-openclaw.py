#!/usr/bin/env python3
"""One-line SMTP proof. OpenClaw only. Never the agent list.

Sends to yperez@healthexps.com (or TEST_TO). Cursor never runs this.
Credentials: industry-pulse-email.env or smtp.env on the OpenClaw box.
"""

from __future__ import annotations

import importlib.util
import os
import smtplib
import ssl
from datetime import datetime, timezone
from email.mime.text import MIMEText
from pathlib import Path

_SIBLING = Path(__file__).resolve().parent / "send-pulse-openclaw.py"
_SPEC = importlib.util.spec_from_file_location("send_pulse_openclaw", _SIBLING)
if _SPEC is None or _SPEC.loader is None:
    raise SystemExit("Cannot load send-pulse-openclaw.py")
_MOD = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_MOD)
smtp_settings = _MOD.smtp_settings


def main() -> None:
    to = (os.environ.get("TEST_TO") or "yperez@healthexps.com").strip()
    if to.lower() != "yperez@healthexps.com" and not os.environ.get("TEST_TO_OK"):
        raise SystemExit(
            "Refusing to send test mail except to yperez@healthexps.com. "
            "Set TEST_TO + TEST_TO_OK=1 only if Yahoska asked."
        )
    host, port, user, password = smtp_settings()
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    body = (
        f"Igor Railway SMTP test {now}.\n"
        f"From {user} via {host}:{port}.\n"
        "If you got this, Pulse / fail-mail can use the same creds.\n"
    )
    msg = MIMEText(body, "plain", "utf-8")
    msg["From"] = user
    msg["To"] = to
    msg["Subject"] = "Igor SMTP test — Yahoska only"
    context = ssl.create_default_context()
    with smtplib.SMTP(host, port, timeout=45) as smtp:
        smtp.starttls(context=context)
        smtp.login(user, password)
        smtp.sendmail(user, [to], msg.as_string())
    print(f"TEST SENT to {to} from {user}")


if __name__ == "__main__":
    main()
