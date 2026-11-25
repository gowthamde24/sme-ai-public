"""HubSpot (private app access token), CRM API v3. Docs: docs/contracts/crm-push.md (section HubSpot). Find the contact (email, then phone), make or change it, add a note linked to it."""

# ruff: noqa: E501

from __future__ import annotations

from datetime import UTC, datetime

from app.crm_push.adapters.base import (
    Adapter,
    Outcome,
    Setting,
    Spec,
    default_note_mapping,
    dig,
    done,
    failed,
    first_num,
)
from app.crm_push.fields import Record, has_note, mapped_fields, note_text, phone_ten, split_name
from app.crm_push.transport import Http

BASE = "https://api.hubapi.com"
NOTE_TO_CONTACT = 202   # HubSpot-defined association type: note to contact


class HubSpot(Adapter):
    spec = Spec(
        key="hubspot", label="HubSpot", kind="key",
        credentials=(Setting("token", "Private app access token", secret=True, help="HubSpot: Settings, Integrations, Private Apps. Give it the contacts and notes permissions."),),
        targets=(("firstname", "First name"), ("lastname", "Last name"), ("email", "Email"), ("phone", "Phone"), ("mobilephone", "Mobile phone"), ("hs_lead_status", "Lead status"), ("company", "Company")),
        default_mapping=default_note_mapping({"name": "firstname", "phone": "phone", "email": "email", "source": ""}),
        docs=("https://developers.hubspot.com/docs/api/private-apps", "https://developers.hubspot.com/docs/api-reference/crm-contacts-v3/search/post-crm-v3-objects-contacts-search",
              "https://developers.hubspot.com/docs/api-reference/crm-contacts-v3/basic/post-crm-v3-objects-contacts", "https://developers.hubspot.com/docs/api/crm/notes"),
        verify=("the exact scope names for notes", "the phone search property (hs_searchable_calculated_phone_number)", "where to keep the lead source (a custom contact property)"),
        setup_steps=("In HubSpot open Settings, Integrations, Private Apps and make a private app.", "Give it the permissions to read and write contacts and to write notes.", "Copy its access token and paste it here."),
    )

    @staticmethod
    def _h(creds: dict[str, str]) -> dict[str, str]:
        return {"Authorization": f"Bearer {creds['token']}"}

    def test(self, http: Http, creds: dict[str, str], config: dict[str, str], mapping: dict[str, str]) -> Outcome:
        a = http.request("GET", f"{BASE}/crm/v3/objects/contacts", headers=self._h(creds), query={"limit": "1"})
        return done("skipped", a.status) if a.ok else failed(a)

    def _find(self, http: Http, creds: dict[str, str], rec: Record) -> tuple[str | None, Outcome | None]:
        groups = []
        if rec.email:
            groups.append({"filters": [{"propertyName": "email", "operator": "EQ", "value": rec.email}]})
        if rec.phone:
            groups.append({"filters": [{"propertyName": "hs_searchable_calculated_phone_number", "operator": "EQ", "value": phone_ten(rec.phone)}]})
        a = http.request("POST", f"{BASE}/crm/v3/objects/contacts/search", headers=self._h(creds), json_body={"filterGroups": groups, "properties": ["email"], "limit": 1})
        if not a.ok:
            return None, failed(a)
        return first_num(dig(a.body, "results", 0, "id")), None

    def push(self, http: Http, creds: dict[str, str], config: dict[str, str], mapping: dict[str, str], rec: Record) -> Outcome:
        if not rec.phone and not rec.email:
            return done("skipped")
        props = mapped_fields(rec, mapping)
        if mapping.get("name") == "firstname" and rec.name:
            first, last = split_name(rec.name)
            props["firstname"] = first
            if last:
                props["lastname"] = last
        contact_id, bad = self._find(http, creds, rec)
        if bad:
            return bad
        if contact_id:
            a = http.request("PATCH", f"{BASE}/crm/v3/objects/contacts/{contact_id}", headers=self._h(creds), json_body={"properties": props})
            word = "updated"
        else:
            a = http.request("POST", f"{BASE}/crm/v3/objects/contacts", headers=self._h(creds), json_body={"properties": props, "associations": []})
            word = "created"
            contact_id = first_num(dig(a.body, "id")) if a.ok else None
        if not a.ok:
            return failed(a)
        if not contact_id:
            return Outcome(False, "bad_answer", a.status)
        if has_note(rec, mapping):
            n = http.request("POST", f"{BASE}/crm/v3/objects/notes", headers=self._h(creds), json_body={
                "properties": {"hs_timestamp": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"), "hs_note_body": note_text(rec, mapping)},
                "associations": [{"to": {"id": int(contact_id)}, "types": [{"associationCategory": "HUBSPOT_DEFINED", "associationTypeId": NOTE_TO_CONTACT}]}]})
            if not n.ok:
                return failed(n)
            word = "noted"
        return done(word, a.status)
