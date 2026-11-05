"""The assistant does the work, A2b part 3: an enquiry letter in the chat -> its sender through the lead import (added if new, merged if known; Undo) -> found by the number in the letter -> the letter
saved as their enquiry (owner, 5 Nov 2026: "enquiry letter -> enquiry + draft quote"). The draft quote needs the requirement confirmed on the enquiry's screen first: the assistant says so, it never
pretends. The phone number is read from the kept CSV at run time and the letter from the kept text: neither sits in the stored plan."""

# ruff: noqa: E501

from __future__ import annotations

import json
import uuid
from types import SimpleNamespace
from typing import Any

from app.assistant_work.extract import FileReader
from app.lead_sources.service import LeadSourcesService
from app.tasks.dialer import FakeDialer
from app.tasks.knowledge import FixedKnowledge
from app.tasks.service import TasksService
from tests.aw_fakes import FakeWorkStore
from tests.dr_sources_fakes import FakeLeadSourcesRepository, Receiver
from tests.dr_tasks_fakes import FakeTasksRepository
from tests.ea_fakes import FakeTurnDb
from tests.enquiries_fakes import FakeEnquiries
from tests.fakes import TENANT_A, FakeCrmRepository, auth, make_client
from tests.integrations_fakes import FakeIntegrations
from tests.test_aw_files import BASE, MATCHER, cards_of, events, text_of
from tests.test_aw_files_read import FakeLocal, Sees, fid

LETTER = "Dear Sir,\nWe are a retail shop in Guntur. We require 40 Kanjivaram sarees in red and maroon for the wedding season.\nKindly quote your best price.\nRegards, Ramesh, 98480 12345\n"
ENQUIRE = {"decision": "do", "actions": [{"action": "capture_enquiry"}], "cant": "quote_from_enquiry"}
LEAD = uuid.UUID("5a5a5a5a-0000-4000-8000-000000000001")


class Phones(FakeIntegrations):
    def __init__(self, lead: uuid.UUID | None) -> None:
        super().__init__()
        self.lead = lead
        self.asked: list[str] = []

    def contact_by_phone(self, token: str, tenant_id: uuid.UUID, phone: str) -> dict[str, Any]:
        self.asked.append(phone)
        if self.lead is None:
            return {"found": False, "holders": []}
        return {"found": True, "contact_id": str(uuid.uuid4()), "full_name": "Ramesh", "company_id": None, "company_name": None, "lead_ids": [str(self.lead)], "holders": []}


def world(*answers: Any, known: bool = False, lead: uuid.UUID | None = LEAD) -> tuple[Any, Sees, FakeWorkStore, FakeEnquiries, Phones, FakeLeadSourcesRepository]:
    llm = Sees(*answers)
    db = FakeTurnDb()
    store = FakeWorkStore()
    crm = FakeCrmRepository()
    crm.seed("leads", TENANT_A.id, LEAD, status="new")
    enquiries = FakeEnquiries()
    phones = Phones(lead)
    sources = FakeLeadSourcesRepository()
    if known:   # the sender is already a lead: the import's preview finds them
        sources.existing_phones = {"+919848012345"}  # type: ignore[attr-defined]
    agents = SimpleNamespace(assistant_db=lambda token, run_id: db, assistant_llm=lambda: llm, llm_for=lambda job: (lambda: llm), unavailable=None)
    tasks = TasksService(FakeTasksRepository(school=False), FakeDialer(), FixedKnowledge([]))
    client, _ = make_client(agents=agents, tasks=tasks, lead_sources=LeadSourcesService(sources, receiver=Receiver(), matcher=MATCHER), assistant_work=store,  # type: ignore[arg-type]
                            crm=crm, enquiries=enquiries, integrations=phones, assistant_file_reader=FileReader(FakeLocal(text_layer=LETTER)))
    return client, llm, store, enquiries, phones, sources


def ask(client: Any, text: str, language: str = "en") -> list[tuple[str, dict[str, Any]]]:
    f = fid(client, "letter from guntur.pdf", b"%PDF-1.7 " + uuid.uuid4().bytes, "application/pdf")
    body = {"message_id": str(uuid.uuid4()), "conversation_id": None, "text": text, "attachment_ids": [f], "language": language}
    return events(client.post(f"{BASE}/turns", json=body, headers=auth("a_owner")))


def test_the_letter_becomes_a_plan_add_the_sender_find_them_save_the_enquiry_and_the_quote_is_said_plainly() -> None:
    client, llm, store, enquiries, phones, _ = world(ENQUIRE)
    evs = ask(client, "make an enquiry and a draft quote from this letter")
    card = cards_of(evs)[0]
    assert card["kind"] == "file_preview" and [s["tool"] for s in card["plan"]["steps"]] == ["lead-imports.import_leads", "contacts.contact_by_phone", "leads.capture_enquiry"]
    assert card["plan"]["steps"][0]["undoable"] is True and card["plan"]["steps"][2]["undoable"] is False
    said = text_of(evs)
    assert "an enquiry from Ramesh" in said and "the draft quote: confirm the requirement on the enquiry's screen first" in said
    assert enquiries.created == [] and phones.asked == [], "nothing before the OK"
    stored = json.dumps(store.plans[card["plan"]["plan_id"]]["steps"])
    assert "98480 12345" not in stored and "9848012345" not in stored and "Kanjivaram" not in stored, "the number and the letter are not in the stored plan"


def test_do_it_saves_the_enquiry_on_the_lead_found_by_the_letters_number() -> None:
    client, _, store, enquiries, phones, _ = world(ENQUIRE)
    plan_id = cards_of(ask(client, "save this enquiry"))[0]["plan"]["plan_id"]
    done = client.post(f"{BASE}/plans/{plan_id}/decide", json={"decision": "do", "confirmed": False}, headers=auth("a_owner"))
    assert done.status_code == 200 and done.json()["status"] == "done", done.text
    assert phones.asked == ["98480 12345"]
    (created,) = enquiries.created
    assert created["lead_id"] == str(LEAD) and "40 Kanjivaram sarees" in created["body"] and "98480" not in created["body"], "stored on the lead, scrubbed of the number"
    assert store.files == {}, "every kept file of the plan is deleted once it ran"
    again = client.post(f"{BASE}/plans/{plan_id}/decide", json={"decision": "do", "confirmed": False}, headers=auth("a_owner"))
    assert again.status_code == 409 and len(enquiries.created) == 1, "a double tap runs it once"


def test_nobody_found_by_the_number_fails_the_enquiry_step_plainly_and_nothing_is_guessed() -> None:
    client, _, _, enquiries, _, _ = world(ENQUIRE, lead=None)
    plan_id = cards_of(ask(client, "save this enquiry"))[0]["plan"]["plan_id"]
    done = client.post(f"{BASE}/plans/{plan_id}/decide", json={"decision": "do", "confirmed": False}, headers=auth("a_owner")).json()
    assert done["status"] == "partly_done" and done["steps"][2]["status"] == "failed" and done["steps"][2]["error"] == "not_found" and enquiries.created == []


def test_a_letter_with_no_number_is_not_an_enquiry_plan() -> None:
    client, _, _, _, _, _ = world(ENQUIRE)
    from tests.test_aw_files_plan import world as plan_world

    client, llm, _, _ = plan_world(FakeLocal(text_layer="Dear Sir, we require 40 Kanjivaram sarees for the season. Kindly quote. Regards, Ramesh"), ENQUIRE)
    f = fid(client, "letter.pdf", b"%PDF-1.7 " + uuid.uuid4().bytes, "application/pdf")
    body = {"message_id": str(uuid.uuid4()), "conversation_id": None, "text": "save this enquiry", "attachment_ids": [f], "language": "en"}
    evs = events(client.post(f"{BASE}/turns", json=body, headers=auth("a_owner")))
    assert cards_of(evs) == [] and "What shall I do with it?" in text_of(evs), "no sender with a number: the enquiry cannot be tied to anyone"


def test_telugu() -> None:
    client, _, _, _, _, _ = world(ENQUIRE)
    evs = ask(client, "ఈ లేఖ నుండి ఎంక్వైరీ చేయండి", language="te")
    assert "Ramesh నుండి ఎంక్వైరీ" in text_of(evs) and "డ్రాఫ్ట్ కొటేషన్" in text_of(evs)
