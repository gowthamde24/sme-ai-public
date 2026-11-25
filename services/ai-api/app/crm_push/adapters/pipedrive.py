"""Pipedrive (API token). The person: search (v2), make or change (v2); the note: v1 (notes exist only in v1). Docs: docs/contracts/crm-push.md."""

# ruff: noqa: E501

from __future__ import annotations

import html
import re

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
from app.crm_push.fields import Record, has_note, mapped_fields, note_text
from app.crm_push.transport import Http

_DOMAIN = re.compile(r"[a-z0-9][a-z0-9-]{0,60}")
_PLAIN = frozenset({"name", "phone", "email"})   # the person's own fields; anything else a business maps is a custom field (its key from Pipedrive)


class Pipedrive(Adapter):
    spec = Spec(
        key="pipedrive", label="Pipedrive", kind="key",
        credentials=(Setting("api_token", "API token", secret=True, help="Pipedrive: your name, Personal preferences, API."),),
        settings=(Setting("domain", "Company domain", help="The first part of your Pipedrive address.", example="mycompany"),),
        targets=(("name", "Name"), ("phone", "Phone"), ("email", "Email")),
        default_mapping=default_note_mapping({"name": "name", "phone": "phone", "email": "email", "source": ""}),
        docs=("https://pipedrive.readme.io/docs/core-api-concepts-authentication", "https://developers.pipedrive.com/docs/api/v1/Persons", "https://developers.pipedrive.com/docs/api/v1/Notes", "https://developers.pipedrive.com/docs/api/v1/Users"),
        verify=("where the person's id is in the v2 search answer (data.items[].item.id)", "how a phone number is matched by search (the stored text)", "the key of a custom field for the lead source"),
        setup_steps=("In Pipedrive open your name, Personal preferences, API, and copy your personal API token.", "Your company domain is the first part of your Pipedrive address, before .pipedrive.com."),
    )

    def check(self, creds: dict[str, str], config: dict[str, str]) -> str | None:
        return None if _DOMAIN.fullmatch(config.get("domain", "")) else "config"

    @staticmethod
    def _h(creds: dict[str, str]) -> dict[str, str]:
        return {"x-api-token": creds["api_token"]}

    @staticmethod
    def _base(config: dict[str, str]) -> str:
        return f"https://{config['domain']}.pipedrive.com/api"

    def test(self, http: Http, creds: dict[str, str], config: dict[str, str], mapping: dict[str, str]) -> Outcome:
        a = http.request("GET", f"{self._base(config)}/v1/users/me", headers=self._h(creds))
        return done("skipped", a.status) if a.ok else failed(a)

    def push(self, http: Http, creds: dict[str, str], config: dict[str, str], mapping: dict[str, str], rec: Record) -> Outcome:
        if not rec.phone and not rec.email:
            return done("skipped")
        base, h = self._base(config), self._h(creds)
        fields = mapped_fields(rec, mapping)
        body: dict[str, object] = {}
        if "name" in fields:
            body["name"] = fields.pop("name")
        if "email" in fields:
            body["emails"] = [{"value": fields.pop("email"), "primary": True, "label": "work"}]
        if "phone" in fields:
            body["phones"] = [{"value": fields.pop("phone"), "primary": True, "label": "mobile"}]
        if fields:
            body["custom_fields"] = fields
        term = rec.email or rec.phone
        s = http.request("GET", f"{base}/v2/persons/search", headers=h, query={"term": term, "fields": "email" if rec.email else "phone", "exact_match": "true", "limit": "1"})
        if not s.ok:
            return failed(s)
        person = first_num(dig(s.body, "data", "items", 0, "item", "id"))
        if person:
            a = http.request("PATCH", f"{base}/v2/persons/{person}", headers=h, json_body=body)
            word = "updated"
        else:
            body.setdefault("name", rec.name or rec.phone or rec.email)
            a = http.request("POST", f"{base}/v2/persons", headers=h, json_body=body)
            word = "created"
            person = first_num(dig(a.body, "data", "id")) if a.ok else None
        if not a.ok:
            return failed(a)
        if not person:
            return Outcome(False, "bad_answer", a.status)
        if has_note(rec, mapping):
            content = "<br>".join(html.escape(line) for line in note_text(rec, mapping).split("\n"))
            n = http.request("POST", f"{base}/v1/notes", headers=h, json_body={"content": content, "person_id": int(person)})
            if not n.ok:
                return failed(n)
            word = "noted"
        return done(word, a.status)
