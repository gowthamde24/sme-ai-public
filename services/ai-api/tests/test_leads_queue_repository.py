"""The review queue's blind scoring, tested where it is implemented: the PostgREST adapter.

A tiny stand-in for PostgREST serves leads, claims, evidence links and labels (honouring the
filters the adapter sends, e.g. `created_by=eq.<caller>`), so a leak in WHAT the adapter asks
for or WHAT it returns shows up here without a database. The real-stack twin is
tests/integration/test_leads_review_in_db.py.

Blind review means the caller must not learn a lead's score (or band, or factor snapshot)
before they have labelled that lead THEMSELVES: not by reading it, not by filtering on it, not
by the order of the list, and not because a different reviewer already labelled it."""

from __future__ import annotations

import json
import re
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
import pytest

from app.crm.models import decode_cursor
from app.leads.models import LeadLabelOut
from app.leads.repository import PostgrestLeadsRepository
from app.leads.review import score_inputs

TEMPLATE = json.loads(
    (Path(__file__).resolve().parents[3] / "config" / "icp" / "silk-wholesale.v1.json").read_text()
)
TENANT = uuid.UUID(int=0xA)
CALLER = uuid.UUID(int=0xC1)
OTHER = uuid.UUID(int=0xC2)
TOKEN = "caller.jwt.token"
ICP_ID = uuid.UUID(int=0x1C9)
BASE = datetime(2026, 1, 1, tzinfo=UTC)

STRONG_CLAIMS = [
    ("buyer_type", "saree_shop"),
    ("size_band", "large"),
    ("order_scale", "five_or_more_per_order"),
]


def lead_row(n: int, *, strong: bool, company_id: uuid.UUID | None = None) -> dict[str, Any]:
    cid = company_id or uuid.UUID(int=0x1000 + n)
    return {
        "id": str(uuid.UUID(int=0x2000 + n)),
        "tenant_id": str(TENANT),
        "status": "new",
        "source": "import",
        "created_at": (BASE + timedelta(days=n)).isoformat(),
        "company_id": str(cid),
        "contact_id": None,
        "company": {
            "id": str(cid),
            "name": f"DEMO Silk House {n}" if strong else f"DEMO Hardware {n}",
            "city": "Bengaluru",
            "region": None,
            "country": "IN",
            "industry": "Silk sarees" if strong else "Hardware",
            "tags": ["saree", "silk"] if strong else [],
            "type": "prospect",
            "website": None,
        },
        "contact": None,
    }


def claim_rows(row: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        {
            "id": str(uuid.uuid4()),
            "company_id": row["company_id"],
            "predicate": p,
            "value": v,
            "confidence": "unverified",
        }
        for p, v in STRONG_CLAIMS
    ]


def label_row(lead: dict[str, Any], by: uuid.UUID, *, score: int = 77) -> dict[str, Any]:
    return {
        "id": str(uuid.uuid4()),
        "tenant_id": str(TENANT),
        "lead_id": lead["id"],
        "label": "good",
        "reason_code": None,
        "icp_version_id": str(ICP_ID),
        "score": score,
        "score_max_reachable": 100,
        "snapshot": {"score": score, "band": "priority", "factors": []},
        "created_by": str(by),
        "created_via": "manual",
        "created_at": (BASE + timedelta(days=400)).isoformat(),
    }


class Server:
    """What PostgREST would return for the requests the adapter makes."""

    def __init__(
        self, leads: list[dict[str, Any]], *, claims_for_strong: bool = True, labels: Any = ()
    ) -> None:
        self.leads = leads
        self.claims = [
            c for lead in leads if "Silk" in lead["company"]["name"] for c in claim_rows(lead)
        ]
        if not claims_for_strong:
            self.claims = []
        self.labels: list[dict[str, Any]] = list(labels)
        self.requests: list[httpx.Request] = []
        self.client = httpx.Client(
            base_url="http://postgrest.test/rest/v1", transport=httpx.MockTransport(self.handle)
        )
        self.repo = PostgrestLeadsRepository(
            "http://postgrest.test/rest/v1", "anon", client=self.client
        )

    def paths(self) -> list[str]:
        return [r.url.path.rsplit("/", 1)[-1] for r in self.requests]

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        q = dict(request.url.params)
        name = request.url.path.rsplit("/", 1)[-1]
        if name == "icp_config_versions":
            return httpx.Response(200, json=[icp_row()])
        if name == "leads":
            rows = sorted(self.leads, key=lambda r: (r["created_at"], r["id"]), reverse=True)
            if "or" in q:
                m = re.match(
                    r"\(created_at\.lt\.([^,]+),and\(created_at\.eq\.[^,]+,id\.lt\.([^)]+)\)\)",
                    q["or"],
                )
                assert m, q["or"]
                at, rid = m.group(1), m.group(2)
                rows = [r for r in rows if (r["created_at"], r["id"]) < (at, rid)]
            return httpx.Response(200, json=rows[: int(q["limit"])])
        assert name != "claims", "scoring reads the claims_for_scoring view, never the raw table"
        if name == "claims_for_scoring":
            ids = in_list(q["company_id"])
            return httpx.Response(200, json=[c for c in self.claims if c["company_id"] in ids])
        assert name != "evidence_links", (
            "scoring reads the evidence_for_scoring view, never the raw table"
        )
        if name == "evidence_for_scoring":
            return httpx.Response(200, json=[])
        if name == "lead_labels":
            rows = list(self.labels)
            if "lead_id" in q:
                if q["lead_id"].startswith("in."):
                    rows = [r for r in rows if r["lead_id"] in in_list(q["lead_id"])]
                else:
                    rows = [r for r in rows if f"eq.{r['lead_id']}" == q["lead_id"]]
            if "created_by" in q:
                rows = [r for r in rows if f"eq.{r['created_by']}" == q["created_by"]]
            rows.sort(key=lambda r: (r["created_at"], r["id"]), reverse=True)
            return httpx.Response(200, json=rows[: int(q.get("limit", "1000"))])
        raise AssertionError(f"unexpected request: {request.url}")


def in_list(value: str) -> set[str]:
    return set(value.removeprefix("in.(").removesuffix(")").split(","))


def icp_row() -> dict[str, Any]:
    return {
        "id": str(ICP_ID),
        "tenant_id": str(TENANT),
        "version_no": 1,
        "engine": "icp-rules",
        "schema_version": 1,
        "config": TEMPLATE,
        "config_sha256": "a" * 64,
        "created_by": None,
        "created_via": "manual",
        "created_at": BASE.isoformat(),
    }


def queue(server: Server, **kw: Any) -> Any:
    args: dict[str, Any] = {
        "caller_id": CALLER,
        "limit": 20,
        "cursor": None,
        "score_band": None,
        "include_blind_scores": False,
    }
    return server.repo.get_review_queue(TOKEN, TENANT, **{**args, **kw})


def band_of(lead: dict[str, Any], server: Server) -> str:
    claims = [c for c in server.claims if c["company_id"] == lead["company_id"]]
    return score_inputs(TEMPLATE, lead["company"], None, claims, []).band


# ------------------------------------------------------------------------------ blind by
# default
def test_blind_queue_hides_every_score_field_of_unlabelled_leads() -> None:
    leads = [lead_row(1, strong=True), lead_row(2, strong=False)]
    page = queue(Server(leads))
    assert len(page.items) == 2
    for item in page.items:
        assert (item.score, item.score_max_reachable, item.score_band, item.snapshot) == (
            None,
            None,
            None,
            None,
        )
        assert item.latest_label is None


def test_non_blind_queue_shows_scores() -> None:
    server = Server([lead_row(1, strong=True)])
    (item,) = queue(server, include_blind_scores=True).items
    assert item.score is not None
    assert item.score_band == band_of(server.leads[0], server)


# ------------------------------------------------------------------------------ band-filter
# leak
def test_a_band_filter_is_refused_while_blind() -> None:
    """Filtering on a hidden value reveals it (ask for 'priority', see who comes back)."""
    server = Server([lead_row(1, strong=True), lead_row(2, strong=False)])
    with pytest.raises(ValueError):
        queue(server, score_band="priority")
    assert server.requests == [], "the refusal must come before any data is fetched"


def test_a_band_filter_works_in_the_deliberate_non_blind_view_and_pages_correctly() -> None:
    leads = [lead_row(n, strong=n % 3 == 0) for n in range(1, 13)]
    server = Server(leads)
    wanted = band_of(leads[2], server)  # lead 3 is "strong"
    matching = [
        lead["id"]
        for lead in sorted(leads, key=lambda r: r["created_at"], reverse=True)
        if band_of(lead, server) == wanted
    ]
    assert len(matching) == 4  # leads 12, 9, 6, 3
    first = queue(server, include_blind_scores=True, score_band=wanted, limit=3)
    assert [str(i.lead_id) for i in first.items] == matching[:3]
    assert first.next_cursor is not None
    second = queue(
        server,
        include_blind_scores=True,
        score_band=wanted,
        limit=3,
        cursor=decode_cursor(first.next_cursor),
    )
    assert [str(i.lead_id) for i in second.items] == matching[3:]
    assert second.next_cursor is None


# ------------------------------------------------------------------------------ order leak
def test_the_order_never_depends_on_the_score() -> None:
    """The strong (high-scoring) lead is the OLDEST; a score-aware order would float it up."""
    leads = [lead_row(1, strong=True), lead_row(2, strong=False), lead_row(3, strong=False)]
    server = Server(leads)
    for blind in (True, False):
        page = queue(server, include_blind_scores=not blind)
        assert [str(i.lead_id) for i in page.items] == [
            leads[2]["id"],
            leads[1]["id"],
            leads[0]["id"],
        ]
    lead_requests = [r for r in server.requests if r.url.path.endswith("/leads")]
    assert {dict(r.url.params)["order"] for r in lead_requests} == {"created_at.desc,id.desc"}


# ------------------------------------------------------------------------------
# other-reviewer leak
def test_another_reviewers_label_does_not_unblind_this_caller() -> None:
    leads = [lead_row(1, strong=True), lead_row(2, strong=True)]
    server = Server(leads, labels=[label_row(leads[0], OTHER)])
    page = queue(server)
    by_id = {str(i.lead_id): i for i in page.items}
    leaked = by_id[leads[0]["id"]]
    assert (leaked.score, leaked.score_band, leaked.snapshot) == (None, None, None)
    assert leaked.latest_label is None, "the other reviewer's label (and its score) is not shown"
    label_requests = [r for r in server.requests if r.url.path.endswith("/lead_labels")]
    assert label_requests and all(
        dict(r.url.params).get("created_by") == f"eq.{CALLER}" for r in label_requests
    ), "labels are fetched for the CALLER only"


def test_the_callers_own_label_unblinds_that_lead_only() -> None:
    leads = [lead_row(1, strong=True), lead_row(2, strong=True)]
    mine = label_row(leads[0], CALLER, score=61)
    server = Server(leads, labels=[mine, label_row(leads[1], OTHER)])
    by_id = {str(i.lead_id): i for i in queue(server).items}
    unblinded, still_blind = by_id[leads[0]["id"]], by_id[leads[1]["id"]]
    assert unblinded.score is not None and unblinded.score_band is not None
    assert unblinded.latest_label is not None and unblinded.latest_label.created_by == CALLER
    assert still_blind.score is None and still_blind.latest_label is None


# ------------------------------------------------------------------------------ the labels
# list
def labels_page(server: Server, lead: dict[str, Any]) -> list[LeadLabelOut]:
    page = server.repo.list_lead_labels(
        TOKEN, TENANT, viewer_id=CALLER, lead_id=uuid.UUID(lead["id"]), limit=20, cursor=None
    )
    return list(page.items)


def test_label_history_hides_other_reviewers_scores_until_the_caller_has_labelled() -> None:
    lead = lead_row(1, strong=True)
    server = Server([lead], labels=[label_row(lead, OTHER, score=88)])
    (shown,) = labels_page(server, lead)
    assert shown.label.value == "good", "the verdict itself stays visible"
    assert (shown.score, shown.score_max_reachable, shown.snapshot) == (None, None, None)


def test_label_history_shows_scores_once_the_caller_has_labelled_that_lead() -> None:
    lead = lead_row(1, strong=True)
    server = Server(
        [lead], labels=[label_row(lead, OTHER, score=88), label_row(lead, CALLER, score=61)]
    )
    scores = sorted(label.score or 0 for label in labels_page(server, lead))
    assert scores == [61, 88]


# ------------------------------------------------------------------- one source of claims
def test_the_queue_and_the_label_snapshot_read_claims_from_the_same_filtered_source() -> None:
    """Decision 5: unaccepted agent claims do not count toward a score, and the review queue and
    the label snapshot must use the same filtered inputs. Both read the claims_for_scoring
    view
    with the same select and order; neither may read the raw claims table."""
    from app.crm.repository import PostgrestCrmRepository

    leads = [lead_row(1, strong=True)]
    server = Server(leads)
    queue(server, include_blind_scores=True)
    queue_claims = [r for r in server.requests if r.url.path.endswith("/claims_for_scoring")]
    assert len(queue_claims) == 1
    assert not any(r.url.path.endswith("/claims") for r in server.requests)

    seen: list[httpx.Request] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        return httpx.Response(200, json=[])

    client = httpx.Client(
        base_url="http://postgrest.test/rest/v1", transport=httpx.MockTransport(handler)
    )
    PostgrestCrmRepository("http://postgrest.test/rest/v1", "anon", client=client).list_claims(
        TOKEN, TENANT, company_id=uuid.UUID(leads[0]["company_id"])
    )
    (label_claims,) = seen
    a, b = dict(queue_claims[0].url.params), dict(label_claims.url.params)
    assert label_claims.url.path == queue_claims[0].url.path
    assert (a["select"], a["order"]) == (b["select"], b["order"])
    # the view has no archived_at column (it returns live claims only): asking for one is an
    # error
    assert "archived_at" not in a and "archived_at" not in b


# ------------------------------------------------------------------- one source of evidence
def test_the_queue_and_the_label_snapshot_read_evidence_from_the_same_filtered_view() -> None:
    """Unaccepted agent evidence must not count toward a score, in the review queue or in the label
    snapshot: both read the
        evidence_for_scoring view with the same select and order; neither may read the raw
        evidence_links table."""
    from app.leads.repository import PostgrestLeadsRepository

    leads = [lead_row(1, strong=True)]
    server = Server(leads)
    queue(server, include_blind_scores=True)
    queue_evidence = [r for r in server.requests if r.url.path.endswith("/evidence_for_scoring")]
    assert len(queue_evidence) == 1
    assert not any(r.url.path.endswith("/evidence_links") for r in server.requests)

    seen: list[httpx.Request] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        return httpx.Response(200, json=[{"lead_id": leads[0]["id"], "kind": "note", "url": None}])

    client = httpx.Client(
        base_url="http://postgrest.test/rest/v1", transport=httpx.MockTransport(handler)
    )
    repo = PostgrestLeadsRepository("http://postgrest.test/rest/v1", "anon", client=client)
    rows = repo.list_scoring_evidence(TOKEN, TENANT, uuid.UUID(leads[0]["id"]))
    assert rows == [{"lead_id": leads[0]["id"], "kind": "note", "url": None}]
    (label_request,) = seen
    assert label_request.url.path.endswith("/evidence_for_scoring")
    qa, la = dict(queue_evidence[0].url.params), dict(label_request.url.params)
    assert (qa["select"], qa["order"]) == (la["select"], la["order"])


# ------------------------------------------------------------------- unreviewed only
def test_unreviewed_only_returns_unlabelled_leads_and_still_fills_the_page() -> None:
    leads = [lead_row(n, strong=n % 2 == 0) for n in range(1, 13)]
    newest_first = sorted(leads, key=lambda r: r["created_at"], reverse=True)
    labelled = [lead for i, lead in enumerate(newest_first) if i % 2 == 0]  # every other one
    server = Server(leads, labels=[label_row(lead, CALLER) for lead in labelled])
    labelled_ids = {lead["id"] for lead in labelled}
    wanted = [lead["id"] for lead in newest_first if lead["id"] not in labelled_ids]
    first = queue(server, unreviewed_only=True, limit=4)
    assert [str(i.lead_id) for i in first.items] == wanted[:4]
    assert all(i.latest_label is None for i in first.items)
    assert first.next_cursor is not None
    second = queue(server, unreviewed_only=True, limit=4, cursor=decode_cursor(first.next_cursor))
    assert [str(i.lead_id) for i in second.items] == wanted[4:]
    assert second.next_cursor is None


def test_another_reviewers_label_does_not_hide_a_lead_from_my_unreviewed_view() -> None:
    leads = [lead_row(1, strong=True), lead_row(2, strong=False)]
    other = uuid.uuid4()
    server = Server(leads, labels=[label_row(leads[0], other)])
    page = queue(server, unreviewed_only=True)
    assert len(page.items) == 2
