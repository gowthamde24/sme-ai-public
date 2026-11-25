"""Freshsales (Freshworks CRM): API key and the account's address. The contact is made or changed in one call (upsert), then a note is added. Docs: docs/contracts/crm-push.md."""

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
    host_ok,
)
from app.crm_push.fields import Record, has_note, mapped_fields, note_text, phone_ten, split_name
from app.crm_push.transport import Http
from app.webhooks_out import ssrf

SUFFIXES = (".myfreshworks.com", ".freshsales.io")


class Freshsales(Adapter):
    spec = Spec(
        key="freshsales", label="Freshsales", kind="key",
        credentials=(Setting("api_key", "API key", secret=True, help="Freshsales: your picture, Profile settings, API settings."),),
        settings=(Setting("host", "Account address", help="The address shown next to your key, for example mycompany.myfreshworks.com.", example="mycompany.myfreshworks.com"),),
        targets=(("first_name", "First name"), ("last_name", "Last name"), ("mobile_number", "Mobile number"), ("email", "Email"), ("job_title", "Job title")),
        default_mapping=default_note_mapping({"name": "first_name", "phone": "mobile_number", "email": "email", "source": ""}),
        docs=("https://developers.freshworks.com/crm/api/",),
        verify=("the host form of older accounts (freshsales.io)", "the shape of the emails list on upsert (a plain email is sent)", "the answer's id (contact.id or id)", "matching by phone (upsert by mobile_number)"),
        setup_steps=("In Freshsales open your picture, Profile settings, API settings.", "Copy the API key and the account address shown there."),
    )

    def check(self, creds: dict[str, str], config: dict[str, str]) -> str | None:
        host = config.get("host", "").strip().lower().removeprefix("https://").rstrip("/")
        try:
            ssrf.check_url(f"https://{host}/")
        except ssrf.UnsafeUrl:
            return "config"
        return None if host_ok(host, SUFFIXES) else "config"

    @staticmethod
    def _h(creds: dict[str, str]) -> dict[str, str]:
        return {"Authorization": f"Token token={creds['api_key']}"}

    @staticmethod
    def _base(config: dict[str, str]) -> str:
        return f"https://{config['host'].strip().lower().removeprefix('https://').rstrip('/')}/crm/sales/api"

    def test(self, http: Http, creds: dict[str, str], config: dict[str, str], mapping: dict[str, str]) -> Outcome:
        a = http.request("GET", f"{self._base(config)}/contacts/filters", headers=self._h(creds))
        return done("skipped", a.status) if a.ok else failed(a)

    def push(self, http: Http, creds: dict[str, str], config: dict[str, str], mapping: dict[str, str], rec: Record) -> Outcome:
        if not rec.phone and not rec.email:
            return done("skipped")
        base, h = self._base(config), self._h(creds)
        contact: dict[str, object] = dict(mapped_fields(rec, mapping))
        if mapping.get("name") == "first_name" and rec.name:
            contact["first_name"], last = split_name(rec.name)
            if last:
                contact["last_name"] = last
        ident: dict[str, str] = {"emails": rec.email} if rec.email else {"mobile_number": phone_ten(rec.phone)}
        a = http.request("POST", f"{base}/contacts/upsert", headers=h, json_body={"unique_identifier": ident, "contact": contact})
        if not a.ok:
            return failed(a)
        contact_id = first_num(dig(a.body, "contact", "id") or dig(a.body, "id"))
        if not contact_id:
            return Outcome(False, "bad_answer", a.status)
        word = "created" if a.status == 201 else "updated"
        if has_note(rec, mapping):
            n = http.request("POST", f"{base}/notes", headers=h, json_body={"note": {"description": note_text(rec, mapping), "targetable_type": "Contact", "targetable_id": int(contact_id)}})
            if not n.ok:
                return failed(n)
            word = "noted"
        return done(word, a.status)
