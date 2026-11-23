"""LOCAL ONLY (job CD): the steps of docs/runbooks/whatsapp-test-number.md that need the API as the business's Owner, so that you can connect Meta's free test number without writing curl.

    make whatsapp-test ARGS="connect --waba-id <id> --phone-number-id <id> [--display-phone '+1 555 ...']"
    make whatsapp-test ARGS="inbox"
    make whatsapp-test ARGS="reply --lead <lead id> --text 'Hello from the shop'"
    make whatsapp-test ARGS="status"

It signs in as its OWN local test owner (a fixed fake address on a reserved domain, a constant local password, a second factor enrolled on the local stack; the same idea as the demo owner of `make seed-demo`), in its OWN
workspace "WA Test (local)" (slug wa-test-local), so the fictional demo workspace is never mixed with a real phone number. It holds no Meta token and no secret: the token is the API process's (`make dev-api-whatsapp`
reads it hidden); this script only sends the account's NAMES (the WABA id, the phone number id, the name of the secret). It refuses a Supabase URL or an API URL that is not this machine.

  connect  makes the workspace if needed, saves the number (token_ref "meta_test"), activates it and switches automatic sending on in the workspace (the global outbox switch is the operator's:
           `./scripts/dev-enable-outbox.sh on`, which the runbook has you run). Idempotent.
  inbox    lists the conversations: who wrote, what, and whether the 24-hour window is open.
  reply    sends one reply to a lead through the outbox (category reply_to_inbound), exactly as the web will: the policy decides (goes now, waits for your approval, or is blocked, and says why).
  status   the number's state, the templates and the last outbox messages with their delivery steps.

The real-data gate keeps a real phone number out of any workspace that has not been opened: see the runbook, section "The real-data gate", for the decision that is yours."""

from __future__ import annotations

import argparse
import sys
import uuid
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

import httpx  # noqa: E402
import seed_demo  # noqa: E402
from seed_demo import Seeder, SeedError, load_config, require_local  # noqa: E402

TEST_EMAIL = "wa-test-owner@demo.example.test"
TEST_PASSWORD = "Wa-Test-Only-Local-Password-1!"  # noqa: S105 - a local stack account, a different one from the demo owner's
TEST_WORKSPACE_NAME = "WA Test (local)"
TEST_WORKSPACE_SLUG = "wa-test-local"
TOKEN_REF = "meta_test"  # noqa: S105 - the NAME of the secret (the API's WHATSAPP_ACCESS_TOKEN answers to every name), not a token


class TestOwner(Seeder):
    """The seeder's sign-in and workspace steps with this script's own account and workspace (the seeder reads its constants from its module when it runs)."""

    __test__ = False  # not a pytest class

    def __init__(self, config: Any, api: httpx.Client, http: httpx.Client) -> None:
        super().__init__(config, api, http)
        seed_demo.DEMO_EMAIL = TEST_EMAIL
        seed_demo.DEMO_PASSWORD = TEST_PASSWORD
        seed_demo.DEMO_WORKSPACE_NAME = TEST_WORKSPACE_NAME
        seed_demo.DEMO_WORKSPACE_SLUG = TEST_WORKSPACE_SLUG

    @property
    def t(self) -> str:
        return f"/v1/tenants/{self.summary.tenant_id}"

    def call(self, method: str, path: str, body: dict[str, Any] | None = None, *, ok: tuple[int, ...] = (200,), what: str = "that") -> Any:
        r = self._api(method, f"{self.t}{path}", body)
        if r.status_code not in ok:
            code = ""
            try:
                code = f", {r.json()['error']['code']}"
            except (ValueError, KeyError, TypeError):
                pass
            raise SeedError(f"Could not {what} (HTTP {r.status_code}{code}).")
        return r.json() if r.content else None


def connect(o: TestOwner, args: argparse.Namespace) -> None:
    saved = o.call(
        "PUT",
        "/whatsapp/account",
        {"waba_id": args.waba_id, "phone_number_id": args.phone_number_id, "display_phone": args.display_phone, "coexistence": False, "token_ref": TOKEN_REF},
        what="save the WhatsApp number",
    )
    if not saved.get("token_available"):
        print("  NOTE: the API does not hold a token (start it with `make dev-api-whatsapp`): the number is saved, nothing can be sent yet.")
    done = o.call("POST", "/whatsapp/account/activate", what="activate the WhatsApp number")
    o.call("PUT", "/outbox/settings", {"auto_send_enabled": True, "per_customer_daily_limit": 3}, what="switch automatic sending on (is the global outbox switch on? `./scripts/dev-enable-outbox.sh on`)")
    print(f"connect: workspace {TEST_WORKSPACE_SLUG} ({o.summary.tenant_id}); number {args.phone_number_id} is {done.get('status')}; automatic sending is on for this workspace.")
    print(f"  sign in to the web as {TEST_EMAIL} (password in this script; a local account) to see the workspace.")


def inbox(o: TestOwner, _: argparse.Namespace) -> None:
    rows = o.call("GET", "/conversations?limit=20", what="read the conversations")["conversations"]
    if not rows:
        print("inbox: no conversation yet. Send a WhatsApp message from your phone to the test number.")
    for r in rows:
        window = "window OPEN until " + str(r["window_expires_at"]) if r["window_open"] else "window CLOSED (only an approved template can go)"
        stopped = "  STOPPED" if r.get("stopped") else ""
        print(f"lead {r['lead_id']}  {r['name'] or '-'}  [{r['last_direction']}] {r['preview']!r}  {window}{stopped}")


def reply(o: TestOwner, args: argparse.Namespace) -> None:
    message_id = str(uuid.uuid4())
    result = o.call(
        "POST",
        "/outbox/messages",
        {"message_id": message_id, "lead_id": args.lead, "text": args.text, "language": args.language, "category": "reply_to_inbound", "source": "owner"},
        what="make the message",
    )
    m = result["message"]
    print(f"reply: {m['status']} ({m['reason']}); id {message_id}")
    if result.get("dispatched"):
        print(f"  handed to the channel: {result['dispatched']}")
    if m["status"] == "needs_approval":
        print("  It waits for your approval (it has money, a complaint or a first message in it). Approve it in the web (Outbox), or run again with --approve.")
        if args.approve:
            decided = o.call("POST", f"/outbox/messages/{message_id}/approve", {}, what="approve the message (a second factor is needed; this account has one)")
            print(f"  approved: {decided['message']['status']}; handed to the channel: {decided.get('dispatched')}")


def status(o: TestOwner, _: argparse.Namespace) -> None:
    account = o.call("GET", "/whatsapp/account", what="read the account")
    print(f"account: configured={account.get('configured')} status={account.get('status')} number={account.get('phone_number_id')} token_available={account.get('token_available')}")
    for t in o.call("GET", "/whatsapp/templates", what="read the templates")["templates"]:
        print(f"  template {t['name']} ({t['language']}): {t['status']}")
    page = o.call("GET", "/outbox/messages?limit=10", what="read the outbox")
    for m in page.get("items", page.get("messages", [])):
        print(f"  message {m['id']}: {m['status']} ({m.get('reason')}) {m.get('failure_code') or ''}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Local helper for the Meta test number (docs/runbooks/whatsapp-test-number.md)")
    sub = parser.add_subparsers(dest="command", required=True)
    c = sub.add_parser("connect")
    c.add_argument("--waba-id", required=True)
    c.add_argument("--phone-number-id", required=True)
    c.add_argument("--display-phone")
    sub.add_parser("inbox")
    r = sub.add_parser("reply")
    r.add_argument("--lead", required=True)
    r.add_argument("--text", required=True)
    r.add_argument("--language", default="en", choices=["en", "te", "hi", "kn"])
    r.add_argument("--approve", action="store_true")
    sub.add_parser("status")
    args = parser.parse_args(argv)
    config = load_config()
    try:
        require_local(config.supabase_url, "Supabase URL")
        require_local(config.api_url, "API URL")
        with httpx.Client() as api, httpx.Client() as http:
            owner = TestOwner(config, api, http)
            owner.sign_in()
            owner.workspace()
            {"connect": connect, "inbox": inbox, "reply": reply, "status": status}[args.command](owner, args)
    except SeedError as exc:
        print(f"whatsapp-test: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
