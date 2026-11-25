"""Local development only (API_ENV=development): look at what the FAKE providers were asked to send, so a person on localhost can see the receipt e-mail (the sign-up code is echoed by the start answer) without any real send.

`GET /v1/dev/outbox` (signed in) -> {"emails": [{to, subject, body}]}, newest last, of this process only. The router is not registered outside development, and a real sender (Resend) has no outbox to show."""

# ruff: noqa: E501

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends

from app.auth.deps import PrincipalDep, Runtime, get_runtime

router = APIRouter(prefix="/v1/dev", tags=["dev"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]


@router.get("/outbox")
def outbox(principal: PrincipalDep, runtime: RuntimeDep) -> dict[str, Any]:
    sender = runtime.mail_sender
    emails = [{"to": m.to, "subject": m.subject, "body": m.body} for m in getattr(sender, "sent", [])][-50:]
    return {"emails": emails}
