"""Kylas CRM (API key). The lead: search, make (an existing lead is left as it is: Kylas changes need the whole lead sent back), add a note. Source: the official Kylas Postman collection (docs/contracts/crm-push.md)."""

# ruff: noqa: E501

from __future__ import annotations

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

BASE = "https://api.kylas.io/v1"


class Kylas(Adapter):
    spec = Spec(
        key="kylas", label="Kylas", kind="key",
        credentials=(Setting("api_key", "API key", secret=True, help="Kylas: Setup, Integrations, API Keys."),),
        targets=(("firstName", "First name"), ("lastName", "Last name"), ("phone", "Phone"), ("email", "Email")),
        default_mapping=default_note_mapping({"name": "firstName", "phone": "phone", "email": "email", "source": ""}),
        docs=("https://documenter.getpostman.com/view/3365774/UzBiQ8vJ", "https://support.kylas.io/portal/en/kb/articles/how-to-use-api-key-in-to-access-kylas-apis"),
        verify=("a wrong key answers 400, not 401, in one probe", "how a phone number is matched by search", "the shape of the lead source (a picklist id)", "whether lastName is required", "rate limits and duplicate behaviour"),
        setup_steps=("In Kylas open Setup, Integrations, API Keys (needs the Explore or Elevate plan).", "Make a key and paste it here."),
    )

    @staticmethod
    def _h(creds: dict[str, str]) -> dict[str, str]:
        return {"api-key": creds["api_key"]}

    def test(self, http: Http, creds: dict[str, str], config: dict[str, str], mapping: dict[str, str]) -> Outcome:
        a = http.request("GET", f"{BASE}/users/me", headers=self._h(creds))
        if a.status == 400:   # Kylas answers a wrong key with 400 (observed, not documented)
            return Outcome(False, "auth", 400)
        return done("skipped", a.status) if a.ok else failed(a)

    def push(self, http: Http, creds: dict[str, str], config: dict[str, str], mapping: dict[str, str], rec: Record) -> Outcome:
        if not rec.phone and not rec.email:
            return done("skipped")
        h = self._h(creds)
        text = rec.email or phone_ten(rec.phone)
        rule = {"id": "multi_field", "field": "multi_field", "type": "multi_field", "input": "multi_field", "operator": "multi_field", "value": text}
        s = http.request("POST", f"{BASE}/search/lead", headers=h, query={"page": "0", "size": "1"}, json_body={"fields": ["id"], "jsonRule": {"rules": [rule], "condition": "AND", "valid": True}})
        if not s.ok:
            return failed(s)
        lead = first_num(dig(s.body, "content", 0, "id"))
        word = "updated"
        if not lead:
            first, last = split_name(rec.name)
            body: dict[str, object] = {"firstName": first or rec.phone or rec.email, "lastName": last or first or "-"}
            if rec.phone:
                body["phoneNumbers"] = [{"type": "MOBILE", "code": "IN", "dialCode": "+91", "value": phone_ten(rec.phone), "primary": True}]
            if rec.email:
                body["emails"] = [{"type": "OFFICE", "value": rec.email, "primary": True}]
            custom = {k: v for k, v in mapped_fields(rec, mapping).items() if k not in ("firstName", "lastName", "phone", "email")}
            if custom:
                body["customFieldValues"] = custom
            a = http.request("POST", f"{BASE}/leads/", headers=h, json_body=body)
            if not a.ok:
                return failed(a)
            lead = first_num(dig(a.body, "id"))
            word = "created"
            if not lead:
                return Outcome(False, "bad_answer", a.status)
        if has_note(rec, mapping):
            n = http.request("POST", f"{BASE}/notes/relation", headers=h, json_body={"sourceEntity": {"description": note_text(rec, mapping)}, "targetEntityId": int(lead), "targetEntityType": "LEAD"})
            if not n.ok:
                return failed(n)
            word = "noted"
        elif word == "updated":
            word = "skipped"   # an existing lead and nothing to add: nothing was changed
        return done(word)
