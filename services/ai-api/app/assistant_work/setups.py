"""Guided setups in the chat (docs/contracts/assistant-tools.md, section 2 `setup`; owner, 5 Nov 2026): "set up IndiaMART with my key", "forward my JustDial lead e-mails", "put a lead form on my
website", and the screen-only ones (invite the team, the voice and language, follow-up rules, a Google Sheet). A setup card is made by code from the workspace's own state through the same services
the screens use; it never sends anything to anyone. Each card has a stable id per workspace and kind (no table), so its test can be run again later.

Tests (POST /assistant/setups/{setup_id}/test) are PASSIVE or read-only:
  pull_now        IndiaMART with the workspace's own key: in a workspace that takes synthetic data only (the real-data gate closed), the key is CHECKED (one read of the last day) and nothing is
                  imported; with the gate open, the ordinary pull runs (its own rules: dedupe, consent, Do-Not-Disturb).
  send_test_mail  has a forwarded e-mail (or Gmail's confirmation) arrived at the workspace's lead address?
  send_test_lead  has a lead arrived through the website form?
"""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

Kind = Literal["indiamart", "email_forward", "website_form", "team_invite", "voice_language", "followup_rules", "google_sheet"]
KINDS: tuple[str, ...] = ("indiamart", "email_forward", "website_form", "team_invite", "voice_language", "followup_rules", "google_sheet")
_NS = uuid.UUID("5e7a2c11-9b3d-4f8e-a6c2-3d1e9f4b7a20")
RECENT = timedelta(hours=24)

SCREENS: dict[str, dict[str, str]] = {
    "indiamart": {"label": "Lead sources", "href": "/lead-sources"},
    "email_forward": {"label": "Lead sources", "href": "/lead-sources"},
    "website_form": {"label": "Lead sources", "href": "/lead-sources"},
    "team_invite": {"label": "Settings -> Members", "href": "/settings/members"},
    "voice_language": {"label": "Settings -> AI assistant", "href": "/settings/assistant"},
    "followup_rules": {"label": "Lead Desk -> Rules", "href": "/lead-desk/rules"},
    "google_sheet": {"label": "Lead sources -> Google Sheet", "href": "/lead-sources"},
}
TITLES = {
    "indiamart": "Connect IndiaMART with your own key", "email_forward": "Forward your portal lead e-mails", "website_form": "A lead form for your website",
    "team_invite": "Invite your team", "voice_language": "Your assistant's voice and language", "followup_rules": "Follow-up rules", "google_sheet": "Leads from a Google Sheet",
}
STEPS: dict[str, list[str]] = {
    "indiamart": ["Open IndiaMART Lead Manager on a computer.", "Go to Settings, then 'CRM key' (Import/Export Leads), and copy the key.",
                  "Paste it in the box below. It goes straight to a locked store; nobody sees it again.", "Press 'Pull now' to check it."],
    "website_form": ["Copy the form code below into any page of your website (it is plain HTML: no script).", "No website? Share the form link instead: it opens a ready form.",
                     "Fill the form once yourself, then press 'Check'."],
    "team_invite": ["Open Settings -> Members.", "Add each person's e-mail and choose their role (Admin, Sales or Viewer).", "They get an invitation e-mail to join."],
    "voice_language": ["Open Settings -> AI assistant.", "Pick the main language and the voice; press 'Hear it' to listen.", "Save (your second sign-in step is asked)."],
    "followup_rules": ["Open Lead Desk -> Rules.", "Choose the lead source and 'call within N minutes' (calling hours apply).", "Approve once (your second sign-in step is asked)."],
    "google_sheet": ["Open Lead sources -> Google Sheet.", "Share your sheet as 'anyone with the link can view' and paste the link.", "Match the columns once; new rows become leads every 15 minutes."],
}
# the portals whose lead e-mails can be forwarded (what to do in each; the Gmail filter is the same for all)
PORTALS: list[dict[str, Any]] = [
    {"name": "JustDial", "steps": ["In JustDial's 'Business' app or site, open Settings -> Lead e-mails and add the address above.", "Or forward JustDial's lead e-mails with the Gmail filter below."]},
    {"name": "IndiaMART e-mail", "steps": ["IndiaMART sends each enquiry by e-mail: forward them with the Gmail filter below (or connect your IndiaMART key instead)."]},
    {"name": "99acres", "steps": ["In 99acres, open My 99acres -> Responses -> e-mail settings and add the address above.", "Or forward the response e-mails with the Gmail filter below."]},
    {"name": "MagicBricks", "steps": ["Forward MagicBricks' lead e-mails with the Gmail filter below."]},
    {"name": "Sulekha", "steps": ["Forward Sulekha's lead e-mails with the Gmail filter below."]},
]


def setup_id(tenant_id: uuid.UUID, kind: str) -> uuid.UUID:
    return uuid.uuid5(_NS, f"{tenant_id}:{kind}")


def kind_of(tenant_id: uuid.UUID, sid: uuid.UUID) -> str | None:
    return next((k for k in KINDS if setup_id(tenant_id, k) == sid), None)


def card(tenant_id: uuid.UUID, kind: str, *, copy: list[dict[str, Any]] | None = None, portals: list[dict[str, Any]] | None = None, secret: dict[str, Any] | None = None,
         test: str | None = None, steps: list[str] | None = None) -> dict[str, Any]:
    return {"kind": "setup", "id": str(setup_id(tenant_id, kind)), "setup": kind, "title": TITLES[kind], "steps": steps if steps is not None else STEPS.get(kind, []),
            "copy": copy or [], "portals": portals or [], "secret": secret, "test": test, "last_test": None, "screen": SCREENS.get(kind)}


def result(ok: bool, reason: str | None, detail: str) -> dict[str, Any]:
    return {"ok": ok, "reason": reason, "detail": detail, "at": datetime.now(UTC).isoformat()}


def _recent(item: dict[str, Any] | None) -> bool:
    raw = (item or {}).get("last_received_at")
    if not raw:
        return False
    try:
        return datetime.fromisoformat(str(raw).replace("Z", "+00:00")) >= datetime.now(UTC) - RECENT
    except ValueError:
        return False


def received_test(sources: list[dict[str, Any]], kind: str, what: str) -> dict[str, Any]:
    """Has anything arrived through this kind of source in the last day? (Passive: nothing is sent.)"""
    item = next((s for s in sources if s.get("kind") == kind), None)
    if item is None:
        return result(False, "nothing_arrived", f"There is no {what} yet: open the card again to make it.")
    if _recent(item):
        return result(True, None, f"It works: {int(item.get('received_count') or 0)} received so far, the last one in the last day.")
    return result(False, "nothing_arrived", f"Nothing has arrived through the {what} in the last day. Send one yourself, wait a minute and check again.")
