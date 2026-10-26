"""Who a task is about (job DR B1): the model DESCRIBES the people (a segment of the leads, or a name), this module finds them among the workspace's OWN leads and contacts, with the caller's token (row-level security decides what exists).
A stranger can never be reached: a person is a row of the workspace's `leads` that points to one of its `contacts`; a list the owner provides is matched to those rows by the last ten digits of the phone, and a number that matches nothing is NOT contacted (it is reported as unmatched). Suppressed, erased and archived contacts are skipped with a closed reason.

The reads go through a small interface so the planner can be tested with no database."""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol

from app.tasks.models import ProvidedContact, Selector

MAX_PEOPLE = 500
RECENT_DAYS = 7
OLD_DAYS = 30
_UNSAFE = re.compile(r"[^\w .'\-]", re.UNICODE)


@dataclass(frozen=True)
class Person:
    lead_id: uuid.UUID
    contact_id: uuid.UUID
    name: str | None
    phone: str | None
    status: str
    created_at: str
    whatsapp_consent: str
    phone_consent: str
    suppressed: bool
    erased: bool
    archived: bool

    def skip_reason(self) -> str | None:
        if self.erased:
            return "erased"
        if self.archived:
            return "archived"
        if self.suppressed:
            return "suppressed"
        if not self.phone:
            return "no_phone"
        return None


class ContactSource(Protocol):
    def by_segment(self, segment: str, days: int | None, limit: int) -> list[Person]: ...
    def by_name(self, name: str, limit: int) -> list[Person]: ...
    def by_phone_tails(self, tails: list[str]) -> list[Person]: ...


def last10(phone: str | None) -> str:
    digits = re.sub(r"\D", "", phone or "")
    return digits[-10:]


def clean_query(text: str) -> str:
    """A name safe to put in a PostgREST filter: letters, digits, space and . ' - only."""
    return _UNSAFE.sub("", text).strip()[:80]


class DbContactSource:
    """The real source: the assistant's database door (the caller's own rows)."""

    def __init__(self, db: Any) -> None:
        self._db = db

    def _people(self, leads: list[dict[str, Any]]) -> list[Person]:
        ids = sorted({str(lead["contact_id"]) for lead in leads if lead.get("contact_id")})
        contacts: dict[str, dict[str, Any]] = {}
        for i in range(0, len(ids), 80):
            chunk = ids[i : i + 80]
            rows = self._db.rest_rows(
                "task_contacts", "/contacts",
                {"select": "id,full_name,phone,whatsapp_consent,phone_consent,suppressed_at,erased_at,archived_at", "id": "in.(" + ",".join(chunk) + ")"},
            )
            contacts.update({str(r["id"]): r for r in rows})
        out: list[Person] = []
        seen: set[str] = set()
        for lead in leads:
            cid = str(lead.get("contact_id") or "")
            row = contacts.get(cid)
            if not row or cid in seen:
                continue
            seen.add(cid)
            out.append(Person(
                uuid.UUID(str(lead["id"])), uuid.UUID(cid), row.get("full_name"), row.get("phone"), str(lead.get("status") or ""), str(lead.get("created_at") or ""),
                str(row.get("whatsapp_consent") or "unknown"), str(row.get("phone_consent") or "unknown"),
                row.get("suppressed_at") is not None, row.get("erased_at") is not None, row.get("archived_at") is not None,
            ))
        return out

    def by_segment(self, segment: str, days: int | None, limit: int) -> list[Person]:
        params = {"select": "id,contact_id,status,created_at", "archived_at": "is.null", "contact_id": "not.is.null", "status": "neq.disqualified", "order": "created_at.desc", "limit": str(limit)}
        now = datetime.now(UTC)
        if segment == "new_leads":
            params["status"] = "eq.new"
        elif segment == "recent_leads":
            params["created_at"] = "gte." + (now - timedelta(days=days or RECENT_DAYS)).isoformat()
        elif segment == "old_leads":
            params["created_at"] = "lt." + (now - timedelta(days=days or OLD_DAYS)).isoformat()
        return self._people(self._db.rest_rows("task_leads", "/leads", params))

    def by_name(self, name: str, limit: int) -> list[Person]:
        query = clean_query(name)
        if len(query) < 2:
            return []
        rows = self._db.rest_rows("task_find", "/contacts", {"select": "id", "full_name": f"ilike.*{query}*", "archived_at": "is.null", "limit": str(limit)})
        ids = [str(r["id"]) for r in rows]
        if not ids:
            return []
        leads = self._db.rest_rows("task_leads", "/leads", {"select": "id,contact_id,status,created_at", "contact_id": "in.(" + ",".join(ids) + ")", "archived_at": "is.null", "order": "created_at.desc"})
        return self._people(leads)

    def by_phone_tails(self, tails: list[str]) -> list[Person]:
        found: list[Person] = []
        for i in range(0, len(tails), 20):
            chunk = [t for t in tails[i : i + 20] if len(t) >= 7]
            if not chunk:
                continue
            # the last four digits only: a stored number may carry spaces ("+00 000 000 8190"), so a longer run of digits would miss it; the caller keeps only the people whose last ten digits are among the asked ones
            condition = "(" + ",".join(f"phone.ilike.*{t[-4:]}*" for t in chunk) + ")"
            rows = self._db.rest_rows("task_find", "/contacts", {"select": "id", "or": condition, "archived_at": "is.null", "limit": "300"})
            ids = [str(r["id"]) for r in rows]
            if ids:
                leads = self._db.rest_rows("task_leads", "/leads", {"select": "id,contact_id,status,created_at", "contact_id": "in.(" + ",".join(ids) + ")", "archived_at": "is.null", "order": "created_at.desc"})
                found.extend(self._people(leads))
        return found


@dataclass
class Resolved:
    people: list[Person]
    unmatched: list[tuple[str | None, str]]      # (name, last 4 digits) of provided numbers that match no contact
    left_out_no_lead: int
    capped: bool


def resolve(source: ContactSource, selectors: list[Selector], provided: list[ProvidedContact] | None) -> Resolved:
    people: dict[uuid.UUID, Person] = {}
    for selector in selectors:
        if len(people) >= MAX_PEOPLE:
            break
        if selector.name:
            found = source.by_name(selector.name, 20)
        elif selector.segment == "provided_list":
            found = []   # handled below, from the list itself
        else:
            found = source.by_segment(selector.segment or "all_leads", selector.days, MAX_PEOPLE)
        for person in found:
            people.setdefault(person.contact_id, person)
    unmatched: list[tuple[str | None, str]] = []
    if provided:
        tails = {last10(p.phone): p for p in provided if last10(p.phone)}
        matched = source.by_phone_tails(sorted(tails))
        matched_tails = set()
        for person in matched:
            tail = last10(person.phone)
            if tail in tails:
                matched_tails.add(tail)
                people.setdefault(person.contact_id, person)
        for tail, item in tails.items():
            if tail not in matched_tails:
                unmatched.append((item.name, tail[-4:]))
    ordered = list(people.values())
    capped = len(ordered) > MAX_PEOPLE
    return Resolved(ordered[:MAX_PEOPLE], unmatched, 0, capped)
