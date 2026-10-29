"""A raw e-mail as the Cloudflare mail worker hands it over (job EB part B): the sender, the subject, the readable text. Python's own mail parser does the hard part (folded headers, quoted-printable, base64, every
character set, multipart/alternative); this module only picks the text, never opens an attachment and never follows a link. Everything in the mail is untrusted data: it is only cut and read."""

from __future__ import annotations

import base64
import binascii
import html
import re
from email import policy
from email.message import EmailMessage
from email.parser import BytesParser
from email.utils import parseaddr

MAX_RAW = 150_000        # bytes of mail the worker sends whole; a bigger one is sent without its body
MAX_TEXT = 200_000
_TAGS = re.compile(r"<(script|style)\b.*?</\1\s*>|<[^>]+>", re.I | re.S)
_BREAKS = re.compile(r"</?(?:p|div|br|tr|li|h[1-6]|table)\b[^>]*>", re.I)
_SPACE_RUNS = re.compile(r"[ \t\r\f\v]+")
_BLANKS = re.compile(r"\n{3,}")


class Unreadable(Exception):
    pass


def html_to_text(markup: str) -> str:
    """Tags out, line breaks kept where the page had them, entities decoded."""
    text = _TAGS.sub("", _BREAKS.sub("\n", markup))
    text = html.unescape(text)
    return _BLANKS.sub("\n\n", "\n".join(_SPACE_RUNS.sub(" ", line).strip() for line in text.splitlines())).strip()


def read(raw_base64: str) -> dict[str, str | None]:
    """{sender, subject, text, message_id} from the base64 of a raw mail. Raises Unreadable."""
    try:
        raw = base64.b64decode(raw_base64, validate=True)
    except (binascii.Error, ValueError):
        raise Unreadable from None
    if not raw or len(raw) > MAX_RAW:
        raise Unreadable
    try:
        msg = BytesParser(policy=policy.default).parsebytes(raw)
    except Exception:   # noqa: BLE001  the parser raises many kinds on bad input: all mean "cannot read"
        raise Unreadable from None
    text = ""
    if isinstance(msg, EmailMessage):
        part = msg.get_body(preferencelist=("plain", "html"))
        if part is not None:
            try:
                content = part.get_content()
            except Exception:   # noqa: BLE001  an unknown character set and the like
                content = ""
            text = content if part.get_content_type() == "text/plain" else html_to_text(content)
    _, sender = parseaddr(str(msg.get("from") or ""))
    return {
        "sender": sender[:320] or None,
        "subject": " ".join(str(msg.get("subject") or "").split())[:500],
        "text": text.strip()[:MAX_TEXT],
        "message_id": " ".join(str(msg.get("message-id") or "").split())[:300] or None,
    }
