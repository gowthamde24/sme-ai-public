"""Job AT (ADR 0066): the HTTP side of the outbox and call requests against an in-memory fake: authorization order and the role matrix on every endpoint, WHAT is sent to the database, that no body
can carry a phone number, a contact, a status, a reason or an approver, the fixed error mapping, the dispatch loop with the local fake adapter, and the boundary (nothing here can reach a network).
The database rules are pgTAP 76; the real stack is tests/integration/test_outbox_api.py."""

from __future__ import annotations

import ast
import base64
import inspect
import logging
import re
import uuid
from pathlib import Path
from typing import Any, get_args

import pytest

from app.config import ConfigurationError, Settings
from app.main import _outbox_adapter
from app.outbox import adapter as adapter_module
from app.outbox import service
from app.outbox.adapter import LocalFakeAdapter, OutgoingMessage, SendResult, build_adapter
from app.outbox.errors import CustomerStoppedError, OutboxStateError
from app.outbox.models import REASON_TEXT, Category, Reason, Status
from app.tenancy.repository import MfaRequired, UpstreamError
from app.today import service as today_service
from tests.fakes import TENANT_A, TENANT_B, auth, make_client
from tests.outbox_fakes import FakeOutbox, call_row, message_row

M1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"
M2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2"
C1 = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1"
LEAD = "33333333-3333-4333-8333-333333333333"
BASE = f"/v1/tenants/{TENANT_A.id}"
PHONE = "+91 98765 43210"


class World:
    def __init__(self) -> None:
        self.db = FakeOutbox()
        self.adapter = LocalFakeAdapter()
        self.client, _ = make_client(outbox=self.db, outbox_adapter=self.adapter)
        self.db.messages[M1] = message_row(
            M1, status="needs_approval", reason="money", flags=["money"], scheduled_for=None
        )
        self.db.messages[M2] = message_row(M2)
        self.db.calls_rows[C1] = call_row(C1)

    def call(
        self, method: str, path: str, user: str | None, body: Any = None, **claims: Any
    ) -> Any:
        headers = auth(user, **claims) if user else {}
        return self.client.request(method, BASE + path, json=body, headers=headers)


@pytest.fixture
def w() -> World:
    return World()


SUBMIT = {
    "message_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
    "lead_id": LEAD,
    "text": "Thank you for writing to us.",
    "language": "en",
    "category": "reply_to_inbound",
}
CALL = {
    "request_id": "dddddddd-dddd-4ddd-8ddd-ddddddddddd1",
    "lead_id": LEAD,
    "reason": "The customer asked for a call",
    "script_draft": "Hello, this is the shop.",
    "language": "en",
}
# (method, path, body, the roles that may, whether a second factor is needed for the roles that may)
MATRIX: list[tuple[str, str, Any, tuple[str, ...], bool]] = [
    ("POST", "/outbox/messages", SUBMIT, ("a_owner", "a_admin", "a_sales"), False),
    ("GET", "/outbox/messages", None, ("a_owner", "a_admin", "a_sales"), False),
    ("GET", f"/outbox/messages/{M2}", None, ("a_owner", "a_admin", "a_sales"), False),
    ("GET", "/outbox/approvals", None, ("a_owner", "a_admin"), False),
    (
        "POST",
        f"/outbox/messages/{M1}/edit",
        {"text": "The new words"},
        ("a_owner", "a_admin"),
        False,
    ),
    ("POST", f"/outbox/messages/{M1}/approve", None, ("a_owner", "a_admin"), True),
    ("POST", f"/outbox/messages/{M1}/reject", None, ("a_owner", "a_admin"), False),
    ("POST", "/outbox/dispatch", None, ("a_owner", "a_admin"), False),
    ("GET", "/outbox/settings", None, ("a_owner", "a_admin"), False),
    (
        "PUT",
        "/outbox/settings",
        {"auto_send_enabled": True, "per_customer_daily_limit": 3},
        ("a_owner",),
        True,
    ),
    ("POST", "/call-requests", CALL, ("a_owner", "a_admin", "a_sales"), False),
    ("GET", "/call-requests", None, ("a_owner", "a_admin", "a_sales"), False),
    ("GET", f"/call-requests/{C1}", None, ("a_owner", "a_admin", "a_sales"), False),
    ("POST", f"/call-requests/{C1}/approve", None, ("a_owner",), True),
    ("POST", f"/call-requests/{C1}/reject", None, ("a_owner",), True),
]
IDS = [f"{m} {p.replace(M1, '<m>').replace(M2, '<m>').replace(C1, '<c>')}" for m, p, *_ in MATRIX]


@pytest.mark.parametrize(("method", "path", "body", "allowed", "strong"), MATRIX, ids=IDS)
def test_the_role_matrix_of_every_endpoint(
    method: str, path: str, body: Any, allowed: tuple[str, ...], strong: bool
) -> None:
    for user in ("a_owner", "a_admin", "a_sales", "a_viewer"):
        w = World()
        r = w.call(method, path, user, body)
        if user in allowed:
            assert r.status_code == 200, (user, r.status_code, r.text)
        else:
            assert r.status_code == 403 and r.json()["error"]["code"] == "forbidden", (
                user,
                r.status_code,
                r.text,
            )
            assert not [c for c in w.db.calls if c[0] not in ("get_message", "get_call")], (
                f"{user} reached the data layer"
            )
    w = World()
    assert w.call(method, path, "outsider", body).status_code == 404, "a stranger learns nothing"
    assert w.call(method, path, "b_owner", body).status_code == 404, (
        "another business's owner learns nothing"
    )
    assert w.call(method, path, None, body).status_code == 401
    assert w.db.calls == []
    if strong:
        for user in allowed:
            w = World()
            r = w.call(method, path, user, body, aal="aal1")
            assert r.status_code == 403 and r.json()["error"]["code"] == "mfa_required", (
                user,
                r.text,
            )
            assert w.db.calls == [], "a missing second factor never reaches the data layer"


def test_the_caller_token_is_what_the_data_layer_gets(w: World) -> None:
    headers = auth("a_sales")
    assert w.client.post(BASE + "/outbox/messages", json=SUBMIT, headers=headers).status_code == 200
    (name, token, args), *_ = w.db.calls
    assert name == "outbox_submit" and token == headers["Authorization"].removeprefix("Bearer ")
    assert args == {
        "p_message_id": SUBMIT["message_id"],
        "p_tenant_id": str(TENANT_A.id),
        "p_lead_id": LEAD,
        "p_channel": "whatsapp",
        "p_body": SUBMIT["text"],
        "p_language": "en",
        "p_category": "reply_to_inbound",
        "p_source": "owner",
        "p_model_flagged": False,
        "p_uncertain": False,
        "p_media": [],
        "p_keep_record": False,
    }, "no phone number, no contact, no status, no approver: only what the person said"


@pytest.mark.parametrize(
    "extra",
    [
        {"phone": PHONE},
        {"to": PHONE},
        {"contact_id": C1},
        {"status": "queued"},
        {"reason": "auto_allowed"},
        {"channel": "email"},
        {"approved_by": C1},
        {"tenant_id": str(TENANT_B.id)},
        {"flags": []},
    ],
)
def test_a_body_cannot_name_a_phone_a_contact_a_status_a_reason_or_an_approver(
    w: World, extra: dict[str, Any]
) -> None:
    r = w.call("POST", "/outbox/messages", "a_owner", {**SUBMIT, **extra})
    assert r.status_code == 422, r.text
    assert w.db.calls == []


@pytest.mark.parametrize(
    "bad",
    [
        {"text": "x"},
        {"text": "x" * 3001},
        {"language": "fr"},
        {"category": "sms"},
        {"model_flagged": "yes"},
        {"lead_id": "nope"},
        {"source": "system"},
        {"message_id": None},
    ],
)
def test_invalid_input_is_refused_before_the_data_layer(w: World, bad: dict[str, Any]) -> None:
    assert w.call("POST", "/outbox/messages", "a_owner", {**SUBMIT, **bad}).status_code == 422
    assert w.db.calls == []


def test_a_call_request_body_is_closed_too(w: World) -> None:
    for extra in ({"phone": PHONE}, {"status": "approved"}, {"contact_id": C1}):
        assert w.call("POST", "/call-requests", "a_owner", {**CALL, **extra}).status_code == 422
    assert w.call("POST", "/call-requests", "a_owner", {**CALL, "reason": "x"}).status_code == 422
    assert w.db.calls == []


# ---- dispatch
def claim(message_id: str = M2, phone: str = PHONE) -> dict[str, Any]:
    return {
        "id": message_id,
        "lead_id": LEAD,
        "contact_id": C1,
        "phone": phone,
        "body": "Hello there",
        "language": "en",
    }


def test_owner_and_admin_hand_due_messages_to_the_channel_right_after_submitting(w: World) -> None:
    w.db.claims = [claim()]
    r = w.call("POST", "/outbox/messages", "a_owner", SUBMIT)
    assert r.status_code == 200 and r.json()["dispatched"] == {"sent": 1, "failed": 0}
    assert w.db.names() == ["outbox_submit", "outbox_claim_due", "outbox_mark", "get_message"]
    assert len(w.adapter.sent) == 1 and w.adapter.sent[0].body == "Hello there"


def test_sales_submits_but_cannot_dispatch(w: World) -> None:
    w.db.claims = [claim()]
    r = w.call("POST", "/outbox/messages", "a_sales", SUBMIT)
    assert r.status_code == 200 and r.json()["dispatched"] is None
    assert "outbox_claim_due" not in w.db.names() and w.adapter.sent == []


def test_a_replay_dispatches_nothing_and_says_so(w: World) -> None:
    w.db.submit_answer = {"replayed": True}
    w.db.claims = [claim()]
    r = w.call("POST", "/outbox/messages", "a_owner", SUBMIT)
    assert r.json()["replayed"] is True and r.json()["dispatched"] is None and w.adapter.sent == []


def test_the_dispatch_endpoint_counts_what_the_channel_did(w: World) -> None:
    w.db.claims = [claim(M1), claim(M2)]
    w.adapter.fail_next(uuid.UUID(M2), "timeout")
    r = w.call("POST", "/outbox/dispatch", "a_admin")
    assert r.status_code == 200 and r.json() == {"sent": 1, "failed": 1}
    marks = [c[2] for c in w.db.calls if c[0] == "outbox_mark"]
    assert (
        marks[0]["p_outcome"] == "sent"
        and marks[0]["p_adapter"] == "fake"
        and marks[0]["p_adapter_message_id"].startswith("fake-")
    )
    assert marks[1]["p_outcome"] == "failed" and marks[1]["p_failure_code"] == "timeout"


def test_an_adapter_that_raises_is_a_failed_delivery_not_a_crash(w: World) -> None:
    class Broken:
        name = "fake"

        def send(self, message: OutgoingMessage) -> SendResult:
            raise RuntimeError(f"boom {message.to_phone}")

    w.db.claims = [claim()]
    out = service.dispatch_due(w.db, Broken(), "tok", TENANT_A.id)
    assert (out.sent, out.failed) == (0, 1)
    assert [c[2]["p_failure_code"] for c in w.db.calls if c[0] == "outbox_mark"] == [
        "adapter_error"
    ]


def test_if_the_database_cannot_be_told_the_loop_goes_on(w: World) -> None:
    w.db.claims = [claim(M1), claim(M2)]
    real_mark = w.db.mark
    seen: list[str] = []

    def mark(token: str, args: dict[str, Any]) -> dict[str, Any]:
        seen.append(args["p_message_id"])
        if len(seen) == 1:
            raise OutboxStateError("SM501")
        return real_mark(token, args)

    w.db.mark = mark  # type: ignore[method-assign]
    out = service.dispatch_due(w.db, w.adapter, "tok", TENANT_A.id)
    assert seen == [M1, M2] and (out.sent, out.failed) == (1, 0)


def test_a_malformed_claim_is_skipped(w: World) -> None:
    w.db.claims = [{"id": "not-a-uuid", "phone": PHONE}, claim()]
    out = service.dispatch_due(w.db, w.adapter, "tok", TENANT_A.id)
    assert out.sent == 1 and len(w.adapter.sent) == 1


def test_the_phone_number_and_the_text_never_reach_a_log_or_an_answer(
    w: World, caplog: pytest.LogCaptureFixture
) -> None:
    w.db.claims = [claim(phone=PHONE)]
    w.adapter.fail_next(uuid.UUID(M2))
    with caplog.at_level(logging.DEBUG):
        r = w.call("POST", "/outbox/dispatch", "a_owner")
    assert (
        PHONE not in caplog.text and "98765" not in caplog.text and "Hello there" not in caplog.text
    )
    assert PHONE not in r.text and "98765" not in r.text
    assert PHONE not in repr(OutgoingMessage(uuid.uuid4(), PHONE, "Hello there", "en")), (
        "the dataclass hides both in its repr"
    )


# ---- decisions
def test_approving_hands_due_messages_to_the_channel_and_rejecting_does_not(w: World) -> None:
    w.db.claims = [claim()]
    r = w.call("POST", f"/outbox/messages/{M1}/approve", "a_owner")
    assert (
        r.status_code == 200
        and r.json()["message"]["reason"] == "owner_approved"
        and r.json()["dispatched"] == {"sent": 1, "failed": 0}
    )
    w2 = World()
    w2.db.claims = [claim()]
    r = w2.call("POST", f"/outbox/messages/{M1}/reject", "a_owner")
    assert (
        r.json()["message"]["status"] == "blocked"
        and r.json()["dispatched"] is None
        and "outbox_claim_due" not in w2.db.names()
    )


def test_an_edit_sends_only_the_words(w: World) -> None:
    w.call("POST", f"/outbox/messages/{M1}/edit", "a_admin", {"text": "  New words here  "})
    name, _token, args = next(c for c in w.db.calls if c[0] == "outbox_edit")
    assert name == "outbox_edit" and args["text"] == "New words here"
    assert (
        w.call(
            "POST", f"/outbox/messages/{M1}/edit", "a_admin", {"text": "x", "status": "queued"}
        ).status_code
        == 422
    )


def test_ids_that_are_not_uuids_or_not_visible_are_404(w: World) -> None:
    for path in (
        "/outbox/messages/nope",
        "/outbox/messages/nope/approve",
        "/call-requests/nope",
        f"/outbox/messages/{uuid.uuid4()}",
        f"/call-requests/{uuid.uuid4()}",
    ):
        method = "POST" if path.endswith("approve") else "GET"
        assert w.call(method, path, "a_owner").status_code == 404, path


# ---- the fixed error mapping
@pytest.mark.parametrize(
    ("error", "status", "code"),
    [
        (OutboxStateError("SM501"), 409, "outbox_state"),
        (CustomerStoppedError("SM502"), 409, "customer_stopped"),
        (MfaRequired("SM306"), 403, "mfa_required"),
        (UpstreamError("PGRST000 boom with a phone +91 98765 43210"), 502, "upstream_error"),
    ],
)
def test_a_refusal_has_a_fixed_sentence_and_no_data_layer_text(
    w: World, error: Exception, status: int, code: str
) -> None:
    w.db.raise_next = error
    r = w.call("POST", f"/outbox/messages/{M1}/approve", "a_owner")
    assert (r.status_code, r.json()["error"]["code"]) == (status, code)
    assert "98765" not in r.text and "PGRST" not in r.text and "boom" not in r.text


# ---- paging
def test_the_cursor_round_trips_and_a_bad_one_is_a_422(w: World) -> None:
    stamp = "2026-10-10T10:00:00+00:00"
    cursor = service.encode_cursor(stamp, uuid.UUID(M1))
    assert service.decode_cursor(cursor) == (stamp, uuid.UUID(M1))
    assert service.decode_cursor(None) is None
    for bad in (
        "!!",
        base64.urlsafe_b64encode(b"nope").decode(),
        base64.urlsafe_b64encode(b"2026-10-10T10:00:00+00:00|nope").decode(),
    ):
        assert w.call("GET", f"/outbox/messages?after={bad}", "a_owner").status_code == 422, bad
    page = w.call("GET", "/outbox/messages?limit=2", "a_owner").json()
    assert len(page["items"]) == 2 and page["next_cursor"] is not None
    assert w.call("GET", "/outbox/messages?limit=5", "a_owner").json()["next_cursor"] is None
    assert w.call("GET", "/outbox/messages?status=unknown", "a_owner").status_code == 422
    assert w.call("GET", "/outbox/messages?limit=101", "a_owner").status_code == 422


def test_the_approval_queue_is_only_what_waits(w: World) -> None:
    items = w.call("GET", "/outbox/approvals", "a_owner").json()["items"]
    assert [i["id"] for i in items] == [M1] and items[0]["status"] == "needs_approval"
    assert (
        items[0]["customer"] == "Synthetic Silks"
        and items[0]["reason_text"] == REASON_TEXT["money"]
    )
    assert "phone" not in str(items[0]) and "contact_id" in items[0]


def test_a_row_that_does_not_fit_the_contract_is_an_upstream_failure_never_a_half_answer(
    w: World,
) -> None:
    w.db.messages[M2]["status"] = "teleported"
    r = w.call("GET", f"/outbox/messages/{M2}", "a_owner")
    assert r.status_code == 502 and r.json()["error"]["code"] == "upstream_error"


# ---- the contract is pinned to the migration
def migration_text() -> str:
    path = next(
        (Path(__file__).resolve().parents[3] / "supabase" / "migrations").glob("*_at_outbox.sql")
    )
    return path.read_text()


def check_list(table_sql: str, column: str) -> set[str]:
    match = re.search(rf"\b{column}\s+text\b[^,]*?check \({column} in \(([^)]*)\)", table_sql, re.S)
    assert match, column
    return set(re.findall(r"'([a-z_]+)'", match.group(1)))


def test_the_reasons_statuses_and_categories_are_the_databases() -> None:
    sql = migration_text()
    table = sql[
        sql.index("create table public.outbox_messages") : sql.index(
            "create table public.call_requests"
        )
    ]
    assert check_list(table, "status") == set(get_args(Status))
    assert check_list(table, "category") == set(get_args(Category))
    reason_block = table[table.index("reason ") : table.index("flags ")]
    assert (
        set(re.findall(r"'([a-z_]+)'", reason_block)) == set(get_args(Reason)) == set(REASON_TEXT)
    )


def test_today_knows_the_two_new_kinds() -> None:
    raw: dict[str, Any] = {
        "cards": {"waiting": 2, "money_held_paise": 0, "orders_open": 0},
        "needs_you": [
            {
                "kind": "outbox_approval",
                "id": M1,
                "customer": "Synthetic Silks",
                "city": None,
                "agent": "followup_desk",
                "ref": "followup",
                "amount_paise": None,
                "at": "2026-10-10T10:00:00+00:00",
                "target": {"type": "outbox_message", "id": M1},
            },
            {
                "kind": "call_approval",
                "id": C1,
                "customer": "Synthetic Silks",
                "city": None,
                "agent": "followup_desk",
                "ref": "call",
                "amount_paise": None,
                "at": "2026-10-10T10:00:00+00:00",
                "target": {"type": "call_request", "id": C1},
            },
        ],
        "recent": [],
    }
    out = today_service.shape_today(raw)
    assert [i.kind for i in out.needs_you] == ["outbox_approval", "call_approval"]
    assert all("waiting for your approval" in i.summary for i in out.needs_you)


# ---- the boundary: nothing here reaches a network
def test_the_only_adapter_is_the_local_fake_and_it_opens_no_connection() -> None:
    imported: set[str] = set()
    for node in ast.walk(ast.parse(inspect.getsource(adapter_module))):
        if isinstance(node, ast.Import):
            imported |= {n.name.split(".")[0] for n in node.names}
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported.add(node.module.split(".")[0])
    assert imported <= {"__future__", "hashlib", "threading", "uuid", "dataclasses", "typing"}, (
        imported
    )
    assert isinstance(build_adapter("fake"), LocalFakeAdapter)
    for name in ("twilio", "whatsapp", "meta", "", "FAKE"):
        with pytest.raises(ValueError):
            build_adapter(name)


def test_an_unknown_adapter_setting_stops_the_process() -> None:
    with pytest.raises(ConfigurationError):
        _outbox_adapter(Settings(_env_file=None, outbox_adapter="twilio"))  # type: ignore[call-arg]
    assert isinstance(_outbox_adapter(Settings(_env_file=None)), LocalFakeAdapter)  # type: ignore[call-arg]


def test_the_fake_adapter_is_deterministic_and_keeps_what_it_was_given() -> None:
    a = LocalFakeAdapter()
    m = OutgoingMessage(uuid.UUID(M1), PHONE, "Hi", "en")
    r1, r2 = a.send(m), a.send(m)
    assert r1.ok and r1.adapter_message_id == r2.adapter_message_id
    assert r1.adapter_message_id is not None and r1.adapter_message_id.startswith("fake-")
    assert len(a.sent) == 2
    a.fail_next(uuid.UUID(M1), "rejected")
    assert a.send(m) == SendResult(False, None, "rejected") and a.send(m).ok


def test_the_outbox_is_unavailable_without_a_repository_or_adapter() -> None:
    client, _ = make_client()
    r = client.get(BASE + "/outbox/messages", headers=auth("a_owner"))
    assert r.status_code == 503 and r.json()["error"]["code"] == "outbox_unavailable"


# ---------------------------------------------------------------------------------------------- job AY: photos and "keep a record"
PH1 = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1"
PH2 = "dddddddd-dddd-4ddd-8ddd-ddddddddddd2"


def test_photos_and_keep_record_are_passed_on_by_id_and_flag_only(w: World) -> None:
    body = {**SUBMIT, "message_id": str(uuid.uuid4()), "photo_ids": [PH1, PH2], "keep_record": True}
    assert w.call("POST", "/outbox/messages", "a_sales", body).status_code == 200
    args = w.db.calls[0][2]
    assert args["p_media"] == [PH1, PH2] and args["p_keep_record"] is True


@pytest.mark.parametrize(
    "bad",
    [
        {"photo_ids": ["nope"]},
        {"photo_ids": [PH1, PH2, PH1, PH2, PH1]},
        {"photo_ids": "x"},
        {"keep_record": "yes"},
        {"keep_record": 1},
        {"photos": [PH1]},
        {"media": [{"url": "http://x"}]},
    ],
)
def test_photos_and_keep_record_are_validated_before_the_data_layer(
    w: World, bad: dict[str, Any]
) -> None:
    r = w.call(
        "POST", "/outbox/messages", "a_owner", {**SUBMIT, "message_id": str(uuid.uuid4()), **bad}
    )
    assert r.status_code == 422 and w.db.calls == []


def test_a_message_shows_its_photos_as_short_lived_thumbnails_and_never_a_path() -> None:
    from tests.catalogue_fakes import FakeStorage

    db, storage = FakeOutbox(), FakeStorage()
    client, _ = make_client(outbox=db, outbox_adapter=LocalFakeAdapter(), catalogue_storage=storage)
    db.messages[M1] = message_row(
        M1,
        keep_record=True,
        media=[
            {
                "photo_id": PH2,
                "position": 2,
                "photo": {"bucket": "cat-x", "thumb_path": "i/b_t.jpg"},
            },
            {
                "photo_id": PH1,
                "position": 1,
                "photo": {"bucket": "cat-x", "thumb_path": "i/a_t.jpg"},
            },
        ],
    )
    body = client.get(BASE + f"/outbox/messages/{M1}", headers=auth("a_sales")).json()
    assert body["keep_record"] is True
    assert [(m["photo_id"], m["position"]) for m in body["media"]] == [(PH1, 1), (PH2, 2)], (
        "in order"
    )
    assert (
        body["media"][0]["thumb_url"]
        == "http://storage.local/object/sign/cat-x/i/a_t.jpg?token=abc"
    )
    assert set(body["media"][0]) == {"photo_id", "position", "thumb_url"} and "thumb_path" not in str(body) and "bucket" not in str(body)
    signs = [c for c in storage.calls if c[0] == "sign"]
    assert len(signs) == 1 and sorted(signs[0][3]) == ["i/a_t.jpg", "i/b_t.jpg"], (
        "one batch, thumbnails only"
    )
    listing = client.get(BASE + "/outbox/messages", headers=auth("a_sales")).json()
    assert listing["items"][0]["media"][0]["thumb_url"] is not None


def test_a_message_without_photos_has_an_empty_list_and_no_signing(w: World) -> None:
    body = w.call("GET", f"/outbox/messages/{M2}", "a_owner").json()
    assert body["media"] == [] and body["keep_record"] is False


def test_the_channel_is_handed_the_photos_by_reference(w: World) -> None:
    w.db.claims = [
        {
            "id": M2,
            "lead_id": LEAD,
            "contact_id": C1,
            "phone": PHONE,
            "body": "Two sarees",
            "language": "en",
            "media": [
                {
                    "photo_id": PH1,
                    "bucket": "cat-x",
                    "path": "i/a.jpg",
                    "content_type": "image/jpeg",
                }
            ],
        }
    ]
    w.db.messages[M2]["status"] = "queued"
    r = w.call("POST", "/outbox/dispatch", "a_owner")
    assert r.json() == {"sent": 1, "failed": 0}
    (sent,) = w.adapter.sent
    assert [(m.photo_id, m.bucket, m.path, m.content_type) for m in sent.media] == [
        (uuid.UUID(PH1), "cat-x", "i/a.jpg", "image/jpeg")
    ]
    assert "http" not in repr(sent), "a reference, not bytes and not a URL"
