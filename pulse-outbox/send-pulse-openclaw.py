#!/usr/bin/env python3
"""Send the Agent Pulse outbox via OpenClaw SMTP. Cursor never runs this.

Reads READY.json + latest.html from this directory.
Credentials: ~/.openclaw/credentials/industry-pulse-email.env or ~/.openclaw/secrets/smtp.env
Recipients: PULSE_TO env, or PULSE_LIST_FILE (one address per line), or READY.json to[]
"""

from __future__ import annotations

import json
import os
import smtplib
import ssl
from datetime import datetime, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path

OUTBOX = Path(__file__).resolve().parent
READY_PATH = OUTBOX / "READY.json"
HOME = Path.home()
ENV_CANDIDATES = [
    HOME / ".openclaw/credentials/industry-pulse-email.env",
    HOME / ".openclaw/secrets/smtp.env",
]


def load_env_file(path: Path) -> dict[str, str]:
    data: dict[str, str] = {}
    if not path.is_file():
        return data
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        data[key.strip()] = value.strip().strip('"').strip("'")
    return data


def smtp_settings() -> tuple[str, int, str, str]:
    merged: dict[str, str] = {}
    for path in ENV_CANDIDATES:
        merged.update(load_env_file(path))
    user = (
        os.environ.get("SMTP_USER")
        or merged.get("SMTP_USER")
        or merged.get("smtp_user")
        or "info@healthexps.com"
    )
    password = (
        os.environ.get("SMTP_PASS")
        or merged.get("SMTP_PASS")
        or merged.get("SMTP_PASSWORD")
        or merged.get("smtp_pass")
        or merged.get("PASSWORD")
    )
    host = os.environ.get("SMTP_HOST") or merged.get("SMTP_HOST") or "smtp.gmail.com"
    port = int(os.environ.get("SMTP_PORT") or merged.get("SMTP_PORT") or 587)
    if not password:
        raise SystemExit(
            "No SMTP password. Expected industry-pulse-email.env or smtp.env on BOSGAME."
        )
    return host, port, user, password


def recipients(ready: dict) -> list[str]:
    if os.environ.get("PULSE_TO"):
        return [a.strip() for a in os.environ["PULSE_TO"].split(",") if a.strip()]
    list_file = os.environ.get("PULSE_LIST_FILE")
    if list_file and Path(list_file).is_file():
        return [
            line.strip()
            for line in Path(list_file).read_text().splitlines()
            if line.strip() and not line.startswith("#")
        ]
    to = ready.get("to")
    if isinstance(to, list) and to:
        return [str(a).strip() for a in to if str(a).strip()]
    if isinstance(to, str) and to not in ("", "USE_BOSGAME_PULSE_LIST"):
        return [a.strip() for a in to.split(",") if a.strip()]
    raise SystemExit(
        "No recipient list. Set PULSE_TO or PULSE_LIST_FILE on BOSGAME "
        "(same list as last week's Agent Pulse)."
    )


def main() -> None:
    if not READY_PATH.is_file():
        raise SystemExit("No READY.json — nothing to send.")
    ready = json.loads(READY_PATH.read_text())
    if ready.get("status") != "READY":
        raise SystemExit(f"Outbox status is {ready.get('status')!r}, not READY. Skip.")

    html_name = ready.get("html_file") or "latest.html"
    html_path = OUTBOX / html_name
    if not html_path.is_file():
        raise SystemExit(f"Missing {html_path.name}")

    host, port, user, password = smtp_settings()
    to_addrs = recipients(ready)
    subject = ready.get("subject") or "THEI Agent Pulse"
    sender = ready.get("from") or user

    msg = MIMEMultipart("alternative")
    msg["From"] = sender
    msg["To"] = sender
    msg["Bcc"] = ", ".join(to_addrs)
    msg["Subject"] = subject
    msg.attach(MIMEText(html_path.read_text(), "html", "utf-8"))

    context = ssl.create_default_context()
    with smtplib.SMTP(host, port, timeout=45) as smtp:
        smtp.starttls(context=context)
        smtp.login(user, password)
        smtp.sendmail(sender, to_addrs, msg.as_string())

    sent = {
        **ready,
        "status": "SENT",
        "sent_at": datetime.now(timezone.utc).isoformat(),
        "recipient_count": len(to_addrs),
    }
    READY_PATH.write_text(json.dumps(sent, indent=2) + "\n")
    (OUTBOX / "SENT.json").write_text(json.dumps(sent, indent=2) + "\n")
    print(f"SENT {subject} to {len(to_addrs)} recipients")


if __name__ == "__main__":
    main()
