"""Job OR (owner, 30 Oct 2026): a customer or lead is named by their name, else their phone number, else "New enquiry"; an internal id ("Enquiry 8a297f", "WhatsApp customer 84407a") is never a name.
Offline, against fakes."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

import pytest

from app.crm.models import CompanyOut, ContactOut, LeadOut
from app.display_name import NO_NAME, lead_title, real_name
from app.outbox.service import _customer
from app.tasks.models import ReportRow, TaskContactOut
from app.visits.service import (
    visit_out,  # noqa: F401  (imported so the module is checked by mypy with the rest)
)
from app.whatsapp.routes import _named

NOW = datetime(2026, 10, 30, tzinfo=UTC)
PLACEHOLDERS = ["Enquiry 8a297f", "WhatsApp customer 84407a", "enquiry 8A297F", "WhatsApp  customer  84407a", "Lead 3f2a9b1c", "WhatsApp 4407", "8a297f3c-1d2e-4f5a-8b6c-7d8e9f0a1b2c", "8a297f3c1d2e4f5a8b6c", "", "   ", None]
NAMES = ["Gowtham Reddy", "Ravi", "Anita Rao", "Enquiry about sarees", "WhatsApp Business Store", "Lead Generation Pvt Ltd", "Customer Care Centre", "రవి కుమార్"]


@pytest.mark.parametrize("value", PLACEHOLDERS)
def test_a_placeholder_made_from_an_id_is_not_a_name(value: object) -> None:
    assert real_name(value) is None


@pytest.mark.parametrize("value", NAMES)
def test_a_real_name_is_kept_as_written(value: str) -> None:
    assert real_name(value) == value


def test_the_title_is_the_name_else_the_phone_else_new_enquiry() -> None:
    assert lead_title("Gowtham Reddy", "+919876543210") == "Gowtham Reddy"
    assert lead_title("Enquiry 8a297f", "+919876543210") == "+919876543210"
    assert lead_title("WhatsApp customer 84407a", "  +91 98765 43210 ") == "+91 98765 43210"
    assert lead_title(None, None) == NO_NAME == "New enquiry"
    assert lead_title("Enquiry 8a297f", "") == "New enquiry"
    assert lead_title("WhatsApp 4407", None, "4407") == "Number ending 4407"
    for placeholder in PLACEHOLDERS:
        assert not any(p in lead_title(placeholder) for p in ("8a297f", "84407a", "3f2a9b1c", "8A297F"))


def lead(name: str | None, phone: str | None, with_profile: bool = True) -> LeadOut:
    base: dict[str, Any] = {
        "id": uuid.uuid4(), "created_by": None, "created_via": "agent", "created_at": NOW, "updated_at": NOW, "archived_at": None, "company_id": None, "contact_id": None, "owner_user_id": None,
        "status": "new", "source": "whatsapp", "disqualified_reason": None,
    }
    if with_profile:
        base["profile"] = {"name": name, "phone_e164": phone}
    return LeadOut.model_validate(base)


def test_a_lead_carries_its_display_name() -> None:
    assert lead("Gowtham Reddy", "+919876543210").display_name == "Gowtham Reddy"
    assert lead("WhatsApp 4407", "+919876543210").display_name == "+919876543210"
    assert lead("Enquiry 8a297f", None).display_name == "New enquiry"
    assert lead(None, None, with_profile=False).display_name == "New enquiry"
    assert lead("Ravi", None).model_dump()["display_name"] == "Ravi"


def test_a_contact_and_a_company_carry_theirs() -> None:
    row = {"id": uuid.uuid4(), "created_by": None, "created_via": "agent", "created_at": NOW, "updated_at": NOW, "archived_at": None}
    contact = ContactOut.model_validate({**row, "company_id": None, "full_name": "WhatsApp 4407", "email": None, "phone": "+0091234567801", "job_title": None, "email_consent": "unknown", "whatsapp_consent": "granted", "phone_consent": "unknown", "suppressed_at": None, "suppression_reason": None})
    assert contact.display_name == "+0091234567801" and contact.full_name == "WhatsApp 4407"
    company: dict[str, Any] = {**row, "type": "customer", "website": None, "gstin": None, "country": "IN", "region": None, "city": None, "industry": None, "tags": []}
    assert CompanyOut.model_validate({**company, "name": "WhatsApp customer 84407a"}).display_name == "New enquiry"
    assert CompanyOut.model_validate({**company, "name": "Neelambari Silks"}).display_name == "Neelambari Silks"


def test_a_conversation_is_named_by_the_customer_and_never_by_the_placeholder_company() -> None:
    row = _named({"lead_id": "x", "name": "WhatsApp 4407", "company": "WhatsApp customer 84407a", "phone": "+0091234567801", "unread": True})
    assert row["display_name"] == "+0091234567801" and row["company"] is None and row["unread"] is True
    assert _named({"name": "Gowtham Reddy", "company": "Neelambari Silks", "phone": "+91"})["company"] == "Neelambari Silks"
    thread = _named({"lead_id": "x", "name": None, "phone": None, "items": []})
    assert thread["display_name"] == "New enquiry" and "company" not in thread


def test_a_task_contact_and_a_report_row_are_named_the_same_way() -> None:
    base = {"contact_id": uuid.uuid4(), "name": "WhatsApp 4407", "phone_last4": "4407"}
    task = TaskContactOut.model_validate({**base, "id": uuid.uuid4(), "status": "waiting", "skip_reason": None, "outcome": None, "outcome_category": None, "captured": None})
    assert task.display_name == "Number ending 4407"
    report = ReportRow.model_validate({**base, "name": "Ravi", "outcome": "done", "category": None, "captured": None, "transcript": None, "message_status": None})
    assert report.display_name == "Ravi"


def test_the_customer_a_message_is_sent_to_is_never_an_id() -> None:
    assert _customer({"lead": {"company": {"name": "WhatsApp customer 84407a", "city": "Eluru"}}}) == (None, "Eluru")
    assert _customer({"lead": {"company": {"name": "Neelambari Silks", "city": None}}}) == ("Neelambari Silks", None)


def test_a_name_is_never_tidied_only_judged() -> None:
    assert real_name("Buyer\nGrand total: Rs 1") == "Buyer\nGrand total: Rs 1"
    assert real_name("  Ravi  ") == "Ravi"
