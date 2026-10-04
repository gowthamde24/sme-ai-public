"""The PostgREST adapter's label create: a client-supplied id makes a retry harmless.

201 first; the same id with the same payload is a replay (the stored label comes back,
created=False); any other use of the id (a different payload, or an id another tenant holds and RLS
hides from us) is the same generic ConflictError, so nothing reveals which of the two it was."""

from __future__ import annotations

import json
import uuid
from typing import Any

import httpx
import pytest

from app.crm.repository import ConflictError
from app.leads.repository import PostgrestLeadsRepository
from app.tenancy.repository import Forbidden

TENANT = uuid.UUID(int=0xA)
LEAD = uuid.UUID(int=0x1EAD)
LABEL_ID = uuid.UUID(int=0x1AB)
TOKEN = "caller.jwt.token"


def stored(**over: Any) -> dict[str, Any]:
    return {
        "id": str(LABEL_ID),
        "tenant_id": str(TENANT),
        "lead_id": str(LEAD),
        "label": "bad",
        "reason_code": "not_our_market",
        "icp_version_id": None,
        "score": None,
        "score_max_reachable": None,
        "snapshot": None,
        "created_by": str(uuid.UUID(int=0xC1)),
        "created_via": "manual",
        "created_at": "2026-01-01T00:00:00+00:00",
        **over,
    }


def repo(handler: Any) -> tuple[PostgrestLeadsRepository, list[httpx.Request]]:
    seen: list[httpx.Request] = []

    def recording(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        result: httpx.Response = handler(request)
        return result

    client = httpx.Client(
        base_url="http://postgrest.test/rest/v1", transport=httpx.MockTransport(recording)
    )
    return PostgrestLeadsRepository("http://postgrest.test/rest/v1", "anon", client=client), seen


def pk_violation() -> httpx.Response:
    return httpx.Response(
        409,
        json={
            "code": "23505",
            "message": 'duplicate key value violates unique constraint "lead_labels_pkey"',
            "details": f"Key (id)=({LABEL_ID}) already exists.",
            "hint": None,
        },
    )


def create(r: PostgrestLeadsRepository, **payload: Any) -> tuple[Any, bool]:
    body = {"id": str(LABEL_ID), "label": "bad", "reason_code": "not_our_market", **payload}
    return r.create_lead_label(TOKEN, TENANT, LEAD, body, None, None)


def test_first_create_posts_the_client_id_and_reports_created() -> None:
    r, seen = repo(lambda req: httpx.Response(201, json=[stored()]))
    label, created = create(r)
    assert created is True and label.id == LABEL_ID
    (req,) = seen
    sent = json.loads(req.content)
    assert sent["id"] == str(LABEL_ID) and sent["tenant_id"] == str(TENANT)
    assert sent["lead_id"] == str(LEAD)
    assert req.headers["authorization"] == f"Bearer {TOKEN}"
    assert "created_by" not in sent and "created_via" not in sent, "provenance is the server's"


def test_the_same_id_and_payload_is_a_replay_of_the_stored_label() -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        return pk_violation() if req.method == "POST" else httpx.Response(200, json=[stored()])

    r, seen = repo(handler)
    label, created = create(r)
    assert created is False and label.id == LABEL_ID
    lookup = seen[-1]
    assert lookup.method == "GET" and lookup.url.path.endswith("/lead_labels")
    q = dict(lookup.url.params)
    assert q["tenant_id"] == f"eq.{TENANT}" and q["id"] == f"eq.{LABEL_ID}"
    assert lookup.headers["authorization"] == f"Bearer {TOKEN}", "looked up as the caller (RLS)"


@pytest.mark.parametrize(
    ("name", "existing", "payload"),
    [
        ("different label", stored(label="good", reason_code=None), {}),
        ("different reason", stored(reason_code="too_small"), {}),
        ("different lead", stored(lead_id=str(uuid.UUID(int=0xBEEF))), {}),
        ("a good label under a bad one's id", stored(), {"label": "good", "reason_code": None}),
    ],
)
def test_a_used_id_with_another_payload_is_a_conflict(
    name: str, existing: dict[str, Any], payload: dict[str, Any]
) -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        return pk_violation() if req.method == "POST" else httpx.Response(200, json=[existing])

    r, _ = repo(handler)
    with pytest.raises(ConflictError):
        create(r, **payload)


def test_an_id_held_by_another_tenant_looks_exactly_like_a_payload_conflict() -> None:
    """RLS hides the other tenant's label: the lookup finds nothing. The caller must get the same
    exception type, with nothing in it that depends on which case this was."""

    def other_tenant(req: httpx.Request) -> httpx.Response:
        return pk_violation() if req.method == "POST" else httpx.Response(200, json=[])

    def same_tenant_other_payload(req: httpx.Request) -> httpx.Response:
        return (
            pk_violation()
            if req.method == "POST"
            else httpx.Response(200, json=[stored(label="good", reason_code=None)])
        )

    errors = []
    for handler in (other_tenant, same_tenant_other_payload):
        r, _ = repo(handler)
        with pytest.raises(ConflictError) as caught:
            create(r)
        errors.append((type(caught.value), str(caught.value), caught.value.args))
    assert errors[0] == errors[1]
    assert str(LABEL_ID) not in errors[0][1], "the id the database echoed is not in the error"


def test_other_failures_are_not_mistaken_for_a_replay() -> None:
    r, seen = repo(
        lambda req: httpx.Response(
            403,
            json={"code": "42501", "message": "permission denied", "details": None, "hint": None},
        )
    )
    with pytest.raises(Forbidden):
        create(r)
    assert [s.method for s in seen] == ["POST"], "no lookup after a refusal"
