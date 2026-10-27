"""Job DR / A1 (night run 27 Oct): the nine "Leads & calls" business types as data, the lead playbook a workspace edits, and the knowledge base (sources, drafted facts, approval). Against fakes: no database, no network, no key.
The database's own rules are supabase/tests/database/127_dr_leads_playbook_knowledge.test.sql."""

# ruff: noqa: E501

from __future__ import annotations

import base64
import io
import json
import sys
import uuid
import zipfile
import zlib
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.agents.llm.interface import Trust
from app.assistant.draft import build_request as draft_request
from app.knowledge import extract, readers
from app.knowledge.prompt import NOTHING, facts_block, playbook_block
from app.knowledge.service import KnowledgeService
from app.leadspack.models import PRICE_OR_PROMISE
from app.leadspack.service import LeadPlaybookService
from app.leadspack.templates import Templates, default_templates
from tests.dr_fakes import FakeKnowledgeRepository, FakePlaybookRepository
from tests.fakes import TENANT_A, auth, make_client
from tests.test_lead_tools import BASE as LEAD_BASE
from tests.test_lead_tools import GOOD_EN, CrmFake, FakeDb, Scripted

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts"))
import packs_check as pc  # noqa: E402

NINE = ("real_estate", "coaching", "clinic", "insurance_loans", "auto_dealer", "interiors_solar", "travel", "gym", "wholesale_b2b")
T = f"/v1/tenants/{TENANT_A.id}"


def world(pack: str | None = "real_estate", **kw: Any) -> tuple[Any, FakePlaybookRepository, FakeKnowledgeRepository]:
    playbooks, knowledge = FakePlaybookRepository(pack), FakeKnowledgeRepository()
    client, _ = make_client(lead_playbook=LeadPlaybookService(playbooks, default_templates()), knowledge=KnowledgeService(knowledge, **kw))
    return client, playbooks, knowledge


# ============================================================================ the nine types as data
def test_the_nine_types_are_packs_with_a_template_and_the_checker_passes() -> None:
    assert pc.check_all() == []
    packs = pc.load_packs()
    for name in NINE:
        assert packs[name]["status"] == "preview" and not packs[name]["default_for_existing_workspaces"], name
        assert (ROOT / "packages" / "packs" / name / "leads.json").is_file(), name
    assert not any((ROOT / "packages" / "packs" / n / "leads.json").exists() for n in ("textiles", "construction_materials", "education")), "the three deep packs are unchanged"


def test_every_template_asks_questions_that_fill_a_field_and_states_no_price() -> None:
    templates = default_templates()
    assert templates.ids() == sorted([*NINE, "general_business"])   # job DT: the generic type next to the nine
    for name in [*NINE, "general_business"]:
        t = templates.get(name)
        assert t is not None and 3 <= len(t.questions) <= 8 and len(t.objections) >= 3 and t.safety
        fields = templates.contact_fields(name)
        assert all(q.field in fields for q in t.questions), name
        for text in [o.answer.en for o in t.objections] + [f.message.en for f in t.followups if f.message] + [t.goal.ask.en]:
            assert not PRICE_OR_PROMISE.search(text), (name, text)
        assert any(f.when == "no_answer" and f.channel == "call" for f in t.followups), "a retry by call"
        assert {f.when for f in t.followups} >= {"no_answer", "interested", "callback"}
        assert t.goal.label.te and t.goal.label.hi and t.goal.label.kn


def test_the_checker_and_the_models_use_the_same_words_for_a_price_or_a_promise() -> None:
    assert pc.PRICE_OR_PROMISE.pattern == PRICE_OR_PROMISE.pattern
    for bad in ("It costs ₹ 500.", "Only Rs 500 today", "We guarantee it.", "A 10% discount", "3 lakh budget"):
        assert PRICE_OR_PROMISE.search(bad), bad
    for fine in ("I cannot promise a date.", "We do not guarantee anything.", "Never promise approval.", "Which budget suits you?"):
        assert not PRICE_OR_PROMISE.search(fine), fine


def test_a_template_that_names_a_missing_field_or_states_a_price_is_refused_by_the_checker(tmp_path: Path) -> None:
    import shutil

    fake = tmp_path / "packs"
    shutil.copytree(ROOT / "packages" / "packs", fake)
    leads = json.loads((fake / "gym" / "leads.json").read_text(encoding="utf-8"))
    leads["questions"][0]["field"] = "no_such_field"
    leads["objections"][0]["answer"]["en"] = "It is only ₹ 999 a month, a great deal."
    (fake / "gym" / "leads.json").write_text(json.dumps(leads), encoding="utf-8")
    problems = pc.check_all(fake)
    assert any("not a contact custom field" in p for p in problems) and any("states a price or a promise" in p for p in problems)


def test_the_public_template_routes() -> None:
    client, _, _ = world()
    listing = client.get("/v1/lead-templates")
    assert listing.status_code == 200 and "max-age" in listing.headers["cache-control"]
    ids = [t["pack_id"] for t in listing.json()["templates"]]
    assert ids == sorted([*NINE, "general_business"])
    first = listing.json()["templates"][0]
    assert first["goal"]["code"] == "test_drive" and first["goal"]["label"]["te"] and first["question_count"] >= 3 and first["validated"] is False
    one = client.get("/v1/lead-templates/real_estate").json()
    assert one["goal"]["code"] == "site_visit" and one["questions"][2]["field_definition"]["kind"] == "choice"
    assert one["questions"][2]["field_definition"]["choices"][0]["code"] == "under_30l"
    assert one["followups"][0] == {"when": "no_answer", "after_minutes": 30, "channel": "call", "max_attempts": 3, "message": None}
    assert client.get("/v1/lead-templates/textiles").status_code == 404 and client.get("/v1/lead-templates/nope").status_code == 404


# ============================================================================ the playbook
URL = f"{T}/lead-playbook"


def good_playbook(**changes: Any) -> dict[str, Any]:
    base = default_templates().defaults_playbook("real_estate")
    assert base is not None
    return {**base, **changes}


def test_every_member_reads_the_template_until_the_owner_saves() -> None:
    client, repo, _ = world()
    for user in ("a_owner", "a_admin", "a_sales", "a_viewer"):
        body = client.get(URL, headers=auth(user)).json()
        assert body["template_pack"] == "real_estate" and body["saved"] is False and body["playbook"] == body["defaults"], user
        assert body["safety"] and body["wording"] == "draft" and body["updated_at"] is None
    assert client.get(URL).status_code == 401


def test_a_deep_pack_has_no_playbook() -> None:
    client, _, _ = world(pack="textiles")
    body = client.get(URL, headers=auth("a_owner")).json()
    assert body["template_pack"] is None and body["playbook"] is None and body["safety"] == []
    assert client.put(URL, json=good_playbook(), headers=auth("a_owner")).status_code == 409
    assert client.post(URL + "/reset", headers=auth("a_owner")).status_code == 409


def test_only_the_owner_with_a_second_factor_saves_and_everyone_then_reads_it() -> None:
    client, repo, _ = world()
    edited = good_playbook(goal_ask={"en": "Invite the person for a site visit this week."})
    for user in ("a_admin", "a_sales", "a_viewer"):
        assert client.put(URL, json=edited, headers=auth(user)).status_code in (403, 404), user
    assert client.put(URL, json=edited, headers=auth("a_owner", aal="aal1")).status_code == 403
    assert repo.saved is None
    saved = client.put(URL, json=edited, headers=auth("a_owner")).json()
    assert saved["saved"] is True and saved["playbook"]["goal_ask"]["en"].startswith("Invite the person") and saved["defaults"]["goal_ask"]["en"] != saved["playbook"]["goal_ask"]["en"]
    assert client.get(URL, headers=auth("a_viewer")).json()["playbook"]["goal_ask"]["en"].startswith("Invite the person")
    again = client.post(URL + "/reset", headers=auth("a_owner")).json()
    assert again["saved"] is False and again["playbook"] == again["defaults"]
    assert client.post(URL + "/reset", headers=auth("a_owner", aal="aal1")).status_code == 403


@pytest.mark.parametrize(
    ("change", "reason"),
    [
        ({"questions": [{"field": "no_such_field", "ask": {"en": "Which one?"}, "required": True}]}, "unknown_field"),
        ({"objections": [{"code": "too_costly", "hears": ["costly"], "answer": {"en": "We have it for ₹ 500 only."}}]}, "price_or_promise"),
        ({"objections": [{"code": "worry", "hears": ["worried"], "answer": {"en": "We guarantee full satisfaction always."}}]}, "price_or_promise"),
        ({"followups": [{"when": "no_answer", "after_minutes": -5, "channel": "call", "max_attempts": 1, "message": None}]}, "bad_followup"),
        ({"followups": [{"when": "interested", "after_minutes": 5, "channel": "whatsapp", "max_attempts": 1, "message": None}]}, "bad_followup"),
        ({"questions": [{"field": "interest", "ask": {"en": "Buy or rent?"}, "required": True}, {"field": "interest", "ask": {"en": "Again?"}, "required": False}]}, "duplicate_field"),
        ({"questions": [{"field": "interest", "ask": {"en": f"Question number {i}?"}, "required": False} for i in range(9)]}, "too_many_questions"),
        ({"unknown_key": 1}, "invalid"),
        ({"questions": []}, "invalid"),
    ],
)
def test_a_bad_playbook_is_a_422_with_a_closed_reason(change: dict[str, Any], reason: str) -> None:
    client, repo, _ = world()
    response = client.put(URL, json=good_playbook(**change), headers=auth("a_owner"))
    assert response.status_code == 422 and response.json()["error"]["code"] == "playbook_invalid" and response.json()["error"]["reason"] == reason, response.text
    assert repo.saved is None


def test_garbage_is_a_422_not_a_crash() -> None:
    client, _, _ = world()
    assert client.put(URL, content=b"not json", headers=auth("a_owner")).status_code == 422
    assert client.put(URL, content=b"null", headers=auth("a_owner")).status_code == 422


# ============================================================================ reading files
def docx(*paragraphs: str, table: tuple[str, ...] = ()) -> bytes:
    body = "".join(f"<w:p><w:r><w:t>{p}</w:t></w:r></w:p>" for p in paragraphs)
    if table:
        body += "<w:tbl><w:tr>" + "".join(f"<w:tc><w:p><w:r><w:t>{c}</w:t></w:r></w:p></w:tc>" for c in table) + "</w:tr></w:tbl>"
    xml = f'<?xml version="1.0"?><w:document xmlns:w="x"><w:body>{body}</w:body></w:document>'
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("word/document.xml", xml)
    return buffer.getvalue()


def pdf(text: str, compressed: bool = False) -> bytes:
    stream = f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET".encode()
    if compressed:
        stream = zlib.compress(stream)
    return b"%PDF-1.4\n1 0 obj\n<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream\nendobj\n%%EOF"


def test_plain_text_markdown_and_html_are_read() -> None:
    assert readers.read_document(b"Open 10 to 6.\n\n\n\nVisits free.") == "Open 10 to 6.\n\nVisits free."
    assert "Fees" not in readers.read_document(b"<html><style>.x{}</style><body><p>Open daily</p><script>Fees()</script></body></html>")
    assert readers.read_document("తెలుగు: ఉదయం పది నుండి సాయంత్రం ఆరు వరకు.".encode()).startswith("తెలుగు")
    assert readers.read_document("café 10 to 6".encode("cp1252")) == "café 10 to 6"


def test_a_word_document_is_read_paragraph_by_paragraph_and_cell_by_cell() -> None:
    text = readers.read_document(docx("Green Valley Villas", "Open 10 to 6 &amp; Sundays", table=("2 BHK", "3 BHK")))
    assert text.splitlines()[0] == "Green Valley Villas" and "Open 10 to 6 & Sundays" in text and "2 BHK" in text and "3 BHK" in text


def test_a_pdf_with_text_is_read_and_a_scan_is_not() -> None:
    sentence = "Green Valley Villas are open every day from ten in the morning to six in the evening."
    assert readers.read_document(pdf(sentence)).startswith("Green Valley Villas")
    assert "ten in the morning" in readers.read_document(pdf(sentence, compressed=True))
    scan = b"%PDF-1.4\n1 0 obj\n<< /Length 4 >>\nstream\n\x00\x01\x02\x03\nendstream\n%%EOF"
    with pytest.raises(readers.ReaderUnavailable):
        readers.read_document(scan)
    fake = readers.FakeDocumentReader("Scanned price list text that was read by the fake reader.")
    assert readers.read_document(scan, fake) == "Scanned price list text that was read by the fake reader." and fake.calls == 1


def test_an_image_needs_a_reader() -> None:
    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
    with pytest.raises(readers.ReaderUnavailable):
        readers.read_document(png)
    assert readers.read_document(png, readers.FakeDocumentReader("A photographed brochure.")).startswith("A photographed")


@pytest.mark.parametrize(
    ("data", "error"),
    [
        (b"", readers.Unreadable),
        (b"\x00\x01\x02\x03" * 100, readers.Unsupported),
        (b"x" * (5 * 1024 * 1024 + 1), readers.TooLarge),
        (b"PK\x03\x04 not really a zip", readers.Unsupported),
        (b"   \n \t ", readers.NoText),
    ],
)
def test_bad_files_are_refused_with_a_constant_code(data: bytes, error: type[Exception]) -> None:
    with pytest.raises(error):
        readers.read_document(data)


def test_the_file_type_is_decided_by_its_bytes_not_by_its_name() -> None:
    assert readers.sniff(b"%PDF-1.7 ...") == "pdf" and readers.sniff(docx("x")) == "docx" and readers.sniff(b"hello") == "text"
    renamed = readers.read_document(docx("Prices on request"))
    assert renamed == "Prices on request"


def test_zero_width_and_control_characters_are_removed_before_a_text_is_kept() -> None:
    assert readers.clean("Open​ 10 to 6\x07!") == "Open 10to 6!"
    assert len(readers.clean("a" * 70_000)) == 60_000


# ============================================================================ the source routes
SRC = f"{T}/knowledge/sources"


def paste(source_id: str | None = None, **changes: Any) -> dict[str, Any]:
    return {"source_id": source_id or str(uuid.uuid4()), "kind": "paste", "title": "Our brochure", "text": "Green Valley Villas. Open 10 to 6. Site visits every day.", **changes}


def upload(data: bytes, name: str = "brochure.docx", **changes: Any) -> dict[str, Any]:
    return {"source_id": str(uuid.uuid4()), "kind": "file", "title": "Brochure", "filename": name, "content_type": "application/octet-stream", "content_base64": base64.b64encode(data).decode(), **changes}


def test_owner_and_admin_add_and_list_sources_and_nobody_else() -> None:
    client, _, repo = world()
    for user in ("a_owner", "a_admin"):
        r = client.post(SRC, json=paste(), headers=auth(user))
        assert r.status_code == 201 and r.json()["kind"] == "paste" and r.json()["status"] == "read" and "text" not in r.json(), user
    for user in ("a_sales", "a_viewer"):
        assert client.post(SRC, json=paste(), headers=auth(user)).status_code == 403, user
        assert client.get(SRC, headers=auth(user)).status_code == 403, user
    listed = client.get(SRC, headers=auth("a_owner")).json()["sources"]
    assert len(listed) == 2 and all("text" not in s for s in listed) and listed[0]["facts"] == {"draft": 0, "approved": 0, "rejected": 0}
    assert client.post(SRC, json=paste()).status_code == 401


def test_the_same_source_id_is_a_retry_and_a_file_is_read_into_text() -> None:
    client, _, repo = world()
    body = paste()
    first = client.post(SRC, json=body, headers=auth("a_owner")).json()
    second = client.post(SRC, json=body, headers=auth("a_owner")).json()
    assert first["id"] == second["id"] and len(repo.sources_) == 1
    r = client.post(SRC, json=upload(docx("Open 10 to 6", "Free site visits")), headers=auth("a_owner"))
    assert r.status_code == 201 and r.json()["kind"] == "file" and r.json()["filename"] == "brochure.docx" and r.json()["chars"] == len("Open 10 to 6\nFree site visits")
    assert "Free site visits" in next(s["text"] for s in repo.sources_.values() if s["kind"] == "file"), "only the text is kept"


@pytest.mark.parametrize(
    ("body", "status", "code"),
    [
        (upload(b"\x00\x01\x02\x03" * 100), 415, "unsupported_type"),
        (upload(b"x" * (5 * 1024 * 1024 + 10)), 413, "source_too_large"),
        (upload(b"   \n  "), 422, "no_text_found"),
        (upload(b"%PDF-1.4\n1 0 obj\n<< /Length 2 >>\nstream\n\x00\x01\nendstream\n%%EOF", "scan.pdf"), 503, "reader_unavailable"),
        (upload(b"abc", content_base64="!!!not base64!!!"), 422, "unreadable_file"),
    ],
)
def test_a_file_that_cannot_be_read_says_why(body: dict[str, Any], status: int, code: str) -> None:
    client, _, repo = world()
    r = client.post(SRC, json=body, headers=auth("a_owner"))
    assert (r.status_code, r.json()["error"]["code"]) == (status, code), r.text
    assert repo.sources_ == {}


@pytest.mark.parametrize(
    "body",
    [paste(text=""), paste(text=None), paste(kind="video"), paste(title=""), paste(unknown=1), {**paste(), "content_base64": "AAAA"}, upload(b"abc", filename=None), upload(b"abc", text="x")],
)
def test_a_malformed_source_is_a_422(body: dict[str, Any]) -> None:
    client, _, repo = world()
    assert client.post(SRC, json=body, headers=auth("a_owner")).status_code == 422
    assert repo.sources_ == {}


def test_an_image_is_read_when_a_reader_is_configured() -> None:
    client, _, repo = world(ocr=readers.FakeDocumentReader("Price list read from a photo: haircut and facial."))
    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
    assert client.post(SRC, json=upload(png, "list.png"), headers=auth("a_owner")).status_code == 201
    assert "haircut" in next(iter(repo.sources_.values()))["text"]


def test_a_discarded_source_disappears_from_the_list() -> None:
    client, _, repo = world()
    sid = client.post(SRC, json=paste(), headers=auth("a_owner")).json()["id"]
    assert client.post(f"{SRC}/{sid}/discard", headers=auth("a_admin")).json()["status"] == "discarded"
    assert client.get(SRC, headers=auth("a_owner")).json()["sources"] == []
    assert client.post(f"{SRC}/not-a-uuid/discard", headers=auth("a_owner")).status_code == 404


# ============================================================================ drafting facts with the model
def draft_world(llm: Scripted | None, db: FakeDb | None = None) -> tuple[Any, FakeKnowledgeRepository, FakeDb, str]:
    repo, db = FakeKnowledgeRepository(), db or FakeDb()
    agents = SimpleNamespace(assistant_db=lambda token, run_id: db, assistant_llm=(lambda: llm) if llm else None, llm_for=lambda job: (lambda: llm) if llm else None, unavailable=None)
    client, _ = make_client(agents=agents, knowledge=KnowledgeService(repo), crm=CrmFake())  # type: ignore[arg-type]
    sid = client.post(SRC, json=paste(), headers=auth("a_owner")).json()["id"]
    return client, repo, db, sid


GOOD = {"facts": [{"kind": "hours", "text": "Open every day from 10 am to 6 pm."}, {"kind": "price", "text": "Two bedroom homes start at ₹ 45 lakh."}, {"kind": "location", "text": "Near the ring road, Hyderabad."}]}


def test_the_model_drafts_facts_as_drafts_and_the_run_is_counted_like_every_other_call() -> None:
    llm = Scripted(GOOD)
    client, repo, db, sid = draft_world(llm)
    r = client.post(f"{SRC}/{sid}/draft-facts", headers=auth("a_admin"))
    assert r.status_code == 200, r.text
    facts = r.json()["facts"]
    assert [f["status"] for f in facts] == ["draft"] * 3 and [f["kind"] for f in facts] == ["hours", "price", "location"] and all(f["source_id"] == sid for f in facts)
    names = db.names()
    assert names.index("begin_message") < names.index("reserve_cost") < names.index("record_usage") < names.index("finish")
    assert next(c[1] for c in db.calls if c[0] == "finish") == ("succeeded", None)
    assert repo.sources_[sid]["status"] == "drafted"


def test_the_source_text_reaches_the_model_only_as_untrusted_data() -> None:
    llm = Scripted(GOOD)
    client, _, _, sid = draft_world(llm)
    client.post(f"{SRC}/{sid}/draft-facts", headers=auth("a_owner"))
    request = llm.requests[0]
    system = [b for b in request.blocks if b.trust is Trust.SYSTEM]
    untrusted = [b for b in request.blocks if b.trust is Trust.UNTRUSTED]
    assert len(system) == 1 and "Green Valley" not in system[0].text and len(untrusted) == 1 and "Green Valley Villas" in untrusted[0].text and untrusted[0].text.startswith("<<<DATA ")
    assert request.final_result is not None and request.final_result.name == "list_facts"


def test_what_the_model_returns_is_checked_by_code() -> None:
    structured = {"facts": [
        {"kind": "other", "text": "Rooms from Rs 2000 a night."},           # looks like a price: becomes a price fact
        {"kind": "faq", "text": "See https://example.com for more."},       # a link: dropped
        {"kind": "faq", "text": "ab"},                                      # too short: dropped
        {"kind": "weather", "text": "It is sunny."},                        # unknown kind: dropped
        {"kind": "hours", "text": "Open   daily \n 10 to 6."},              # whitespace folded
        {"kind": "hours", "text": "open daily 10 to 6."},                   # duplicate: dropped
        "not a dict", {"kind": "hours"},
    ]}
    assert extract.accept(structured) == [{"kind": "price", "text": "Rooms from Rs 2000 a night."}, {"kind": "hours", "text": "Open daily 10 to 6."}]
    assert extract.accept({"facts": []}) is None and extract.accept(None) is None and extract.accept({"facts": "x"}) is None
    many = {"facts": [{"kind": "other", "text": f"Fact number {i} about the shop."} for i in range(60)]}
    assert len(extract.accept(many) or []) == 40


def test_an_unusable_answer_is_asked_again_once_and_then_refused() -> None:
    llm = Scripted({"facts": []}, {"facts": []})
    client, repo, db, sid = draft_world(llm)
    r = client.post(f"{SRC}/{sid}/draft-facts", headers=auth("a_owner"))
    assert r.status_code == 502 and r.json()["error"]["code"] == "facts_failed" and len(llm.requests) == 2
    assert "no usable facts" in " ".join(b.text for b in llm.requests[1].blocks)
    assert [c[1] for c in db.calls if c[0] == "finish"] == [("failed", "invalid_output")]
    ok = Scripted({"facts": []}, GOOD)
    client, _, _, sid = draft_world(ok)
    assert client.post(f"{SRC}/{sid}/draft-facts", headers=auth("a_owner")).status_code == 200 and len(ok.requests) == 2


def test_a_busy_or_failed_model_is_a_fixed_answer_and_the_cost_is_released() -> None:
    from app.agents.llm.interface import LlmError, LlmRateLimited

    class Busy(LlmRateLimited):
        pass

    client, _, db, sid = draft_world(Scripted(Busy()))
    r = client.post(f"{SRC}/{sid}/draft-facts", headers=auth("a_owner"))
    assert r.status_code == 503 and r.json()["error"]["code"] == "model_busy"
    assert "release_cost" in db.names() or "finish" in db.names()
    client, _, _, sid = draft_world(Scripted(LlmError()))
    assert client.post(f"{SRC}/{sid}/draft-facts", headers=auth("a_owner")).status_code == 502


def test_only_a_manager_drafts_and_an_unknown_source_is_a_404() -> None:
    client, _, _, sid = draft_world(Scripted(GOOD, GOOD))
    for user in ("a_sales", "a_viewer"):
        assert client.post(f"{SRC}/{sid}/draft-facts", headers=auth(user)).status_code == 403
    assert client.post(f"{SRC}/{uuid.uuid4()}/draft-facts", headers=auth("a_owner")).status_code == 404
    client2, _, _, _ = draft_world(None)
    assert client2.post(f"{SRC}/{uuid.uuid4()}/draft-facts", headers=auth("a_owner")).status_code in (404, 503)


def test_a_new_round_replaces_the_undecided_drafts_and_keeps_the_decided_ones() -> None:
    client, repo, _, sid = draft_world(Scripted(GOOD, {"facts": [{"kind": "policy", "text": "Visits need no booking on weekdays."}]}))
    first = client.post(f"{SRC}/{sid}/draft-facts", headers=auth("a_owner")).json()["facts"]
    client.post(f"{T}/knowledge/facts/{first[0]['id']}/decide", json={"decision": "approve"}, headers=auth("a_admin"))
    second = client.post(f"{SRC}/{sid}/draft-facts", headers=auth("a_owner")).json()["facts"]
    assert len(second) == 1
    statuses = sorted(f["status"] for f in repo.facts_.values())
    assert statuses == ["approved", "draft"]


# ============================================================================ the facts
FACTS = f"{T}/knowledge/facts"


def test_facts_are_added_edited_and_decided_by_owner_and_admin() -> None:
    client, _, _ = world()
    fid = str(uuid.uuid4())
    added = client.post(FACTS, json={"fact_id": fid, "kind": "faq", "text": "Parking is free for visitors."}, headers=auth("a_admin"))
    assert added.status_code == 201 and added.json()["status"] == "draft"
    edited = client.post(f"{FACTS}/{fid}/edit", json={"text": "Parking is free for all visitors."}, headers=auth("a_owner")).json()
    assert edited["edited"] is True and edited["status"] == "draft"
    approved = client.post(f"{FACTS}/{fid}/decide", json={"decision": "approve"}, headers=auth("a_admin")).json()
    assert approved["status"] == "approved" and approved["decided_by_you"] is True
    back = client.post(f"{FACTS}/{fid}/edit", json={"text": "Parking is free on weekdays."}, headers=auth("a_admin")).json()
    assert back["status"] == "draft" and back["decided_at"] is None, "an edit needs approving again"
    for user in ("a_sales", "a_viewer"):
        assert client.post(f"{FACTS}/{fid}/decide", json={"decision": "approve"}, headers=auth(user)).status_code == 403
        assert client.post(FACTS, json={"fact_id": str(uuid.uuid4()), "kind": "faq", "text": "Free parking."}, headers=auth(user)).status_code == 403


@pytest.mark.parametrize(
    "body",
    [
        {"kind": "faq", "text": "ab"},
        {"kind": "faq", "text": "x" * 501},
        {"kind": "weather", "text": "It is sunny."},
        {"kind": "faq", "text": "See https://example.com for more."},
        {"kind": "faq", "text": "See www.example.com for more."},
        {"kind": "faq", "text": "Parking is free.", "unknown": 1},
    ],
)
def test_a_bad_fact_is_a_422(body: dict[str, Any]) -> None:
    client, _, repo = world()
    assert client.post(FACTS, json={"fact_id": str(uuid.uuid4()), **body}, headers=auth("a_owner")).status_code == 422
    assert repo.facts_ == {}
    assert client.post(f"{FACTS}/{uuid.uuid4()}/decide", json={"decision": "maybe"}, headers=auth("a_owner")).status_code == 422
    assert client.post(f"{FACTS}/{uuid.uuid4()}/decide", json={"decision": "approve"}, headers=auth("a_owner")).status_code == 404


def test_the_list_filters_pages_and_every_member_may_read_it() -> None:
    client, _, repo = world()
    for i in range(3):
        client.post(FACTS, json={"fact_id": str(uuid.uuid4()), "kind": "faq", "text": f"Fact number {i} for the list."}, headers=auth("a_owner"))
    first = client.get(FACTS + "?limit=2", headers=auth("a_owner")).json()
    assert len(first["facts"]) == 2 and first["next_cursor"]
    assert ("facts", (None, None, 2, None)) in repo.calls
    client.get(FACTS + f"?limit=2&cursor={first['next_cursor']}", headers=auth("a_owner"))
    assert repo.calls[-1][1][3] is not None
    assert client.get(FACTS + "?status=draft", headers=auth("a_viewer")).status_code == 200 and client.get(FACTS + "?status=bogus", headers=auth("a_owner")).status_code == 422
    assert client.get(FACTS + "?cursor=!!!", headers=auth("a_owner")).status_code == 422 and client.get(FACTS + "?limit=0", headers=auth("a_owner")).status_code == 422


def test_the_knowledge_routes_say_so_when_they_are_not_wired() -> None:
    client, _ = make_client()
    assert client.get(SRC, headers=auth("a_owner")).status_code == 503 and client.get(URL, headers=auth("a_owner")).status_code == 503


# ============================================================================ prompts
def test_the_assistant_may_only_state_approved_facts_and_a_price_only_when_the_channel_may() -> None:
    facts = [{"kind": "hours", "text": "Open 10 to 6."}, {"kind": "price", "text": "Homes from ₹ 45 lakh."}]
    with_prices = facts_block(facts, allow_prices=True)
    without = facts_block(facts, allow_prices=False)
    assert "₹ 45 lakh" in with_prices and "₹ 45 lakh" not in without and "Open 10 to 6." in without and "Do not state any price" in without
    assert facts_block([], allow_prices=True) == NOTHING == facts_block([{"kind": "price", "text": "x"}], allow_prices=False)
    assert "Do not state any fact" in NOTHING


def test_the_playbook_block_names_the_goal_the_questions_the_answers_and_the_safety_rules() -> None:
    t = default_templates().defaults_playbook("clinic")
    assert t is not None
    block = playbook_block(t, default_templates().safety("clinic"), "Book an appointment")
    assert block.startswith("LEAD PLAYBOOK:") and "Goal:" in block and "1. " in block and "[needed]" in block and "Rules for this kind of business:" in block
    assert "symptoms" in block.lower()


def test_the_whatsapp_draft_prompt_gets_approved_facts_without_prices_and_nothing_when_there_are_none() -> None:
    block = facts_block([{"kind": "hours", "text": "Open 10 to 6."}], allow_prices=False)
    texts = [b.text for b in draft_request("d", "en", ["x"], False, None, block).blocks]
    assert block in texts and texts.index(block) < len(texts) - 1
    assert block not in [b.text for b in draft_request("d", "en", ["x"], False).blocks]


def test_a_lead_draft_carries_the_owners_approved_facts_but_never_a_price() -> None:
    repo = FakeKnowledgeRepository()
    repo.facts_["1"] = {"id": "1", "kind": "hours", "text": "Open every day from 10 am to 6 pm.", "status": "approved", "edited": False, "source_id": None, "created_at": "x", "decided_at": "y", "decided_by_you": True}
    repo.facts_["2"] = {"id": "2", "kind": "price", "text": "Homes from ₹ 45 lakh.", "status": "approved", "edited": False, "source_id": None, "created_at": "x", "decided_at": "y", "decided_by_you": True}
    llm = Scripted(GOOD_EN)
    agents = SimpleNamespace(assistant_db=lambda token, run_id: FakeDb(), assistant_llm=lambda: llm, llm_for=lambda job: (lambda: llm), unavailable=None)
    client, _ = make_client(agents=agents, crm=CrmFake(), knowledge=KnowledgeService(repo))  # type: ignore[arg-type]
    r = client.post(LEAD_BASE + "/33333333-3333-4333-8333-333333333333/draft-message", json={}, headers=auth("a_sales"))
    assert r.status_code == 200, r.text
    prompt = "\n".join(b.text for b in llm.requests[0].blocks)
    assert "Open every day from 10 am to 6 pm." in prompt and "45 lakh" not in prompt


def test_a_knowledge_base_that_cannot_be_read_never_stops_a_draft() -> None:
    class Broken:
        def approved(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
            raise RuntimeError("down")

    llm = Scripted(GOOD_EN)
    agents = SimpleNamespace(assistant_db=lambda token, run_id: FakeDb(), assistant_llm=lambda: llm, llm_for=lambda job: (lambda: llm), unavailable=None)
    client, _ = make_client(agents=agents, crm=CrmFake(), knowledge=Broken())  # type: ignore[arg-type]
    assert client.post(LEAD_BASE + "/33333333-3333-4333-8333-333333333333/draft-message", json={}, headers=auth("a_sales")).status_code == 200


# ============================================================================ the contract
def test_the_leads_pack_contract_is_committed_and_fresh() -> None:
    from app.leadspack import contracts

    root = ROOT / "packages" / "contracts"
    assert (root / "leads_pack.schema.json").read_text() == contracts.schema_text(), "run `make contracts`"
    assert (root / "leads_pack.ts").read_text() == contracts.ts_text(), "run `make contracts`"


def test_the_templates_class_can_be_pointed_at_a_folder_without_templates(tmp_path: Path) -> None:
    empty = Templates(tmp_path)
    assert empty.ids() == [] and empty.get("real_estate") is None and empty.summaries().templates == [] and empty.defaults_playbook("gym") is None
    assert Templates(None).ids() == []


def test_the_pack_folder_is_looked_for_only_as_high_as_the_path_goes() -> None:
    """In the image the source is at /srv/app/packs/registry.py: a fixed `parents[4]` raised IndexError at start-up on the first staging deploy of this job."""
    from pathlib import Path

    from app.packs.registry import candidate_directories

    assert candidate_directories(Path("/srv/app/packs/registry.py")) == [Path("/srv/packages/packs")]
    deep = candidate_directories(Path("/work/repo/services/ai-api/app/packs/registry.py"))
    assert deep[0] == Path("/work/repo/packages/packs") and deep[-1] == Path("/srv/packages/packs")
