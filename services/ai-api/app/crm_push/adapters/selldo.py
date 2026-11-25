"""Sell.Do (an API key and the account's host). Sell.Do's API reference is given only to customers, so the calls here follow the vendor's public examples and EVERY one of them is marked 'verify with a real account' in docs/contracts/crm-push.md."""

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
    first_id,
    host_ok,
)
from app.crm_push.fields import Record, has_note, mapped_fields, note_text
from app.crm_push.transport import Http
from app.webhooks_out import ssrf


class SellDo(Adapter):
    spec = Spec(
        key="selldo", label="Sell.Do", kind="key",
        credentials=(Setting("api_key", "API key", secret=True),),
        settings=(Setting("host", "Sell.Do address", help="The address your team signs in at.", example="app.sell.do"),),
        targets=(("name", "Name"), ("phone", "Phone"), ("email", "Email"), ("source", "Source"), ("project", "Project")),
        default_mapping=default_note_mapping({"name": "name", "phone": "phone", "email": "email", "source": "source"}),
        docs=("https://www.sell.do/developers", "https://www.sell.do/real-estate-crm/integrations/api-webhooks"),
        verify=("everything: the API reference is not public (auth scheme, base URL, the create answer, the note call, the required campaign field, errors)",),
        setup_steps=("Ask your Sell.Do admin for an API key and the address your team signs in at.", "Paste both here, then use Test connection."),
    )

    def check(self, creds: dict[str, str], config: dict[str, str]) -> str | None:
        host = config.get("host", "").strip().lower().removeprefix("https://").rstrip("/")
        try:
            ssrf.check_url(f"https://{host}/")
        except ssrf.UnsafeUrl:
            return "config"
        return None if host_ok(host, ("sell.do",)) else "config"

    @staticmethod
    def _h(creds: dict[str, str]) -> dict[str, str]:
        return {"Authorization": f"Bearer {creds['api_key']}"}

    @staticmethod
    def _base(config: dict[str, str]) -> str:
        return f"https://{config['host'].strip().lower().removeprefix('https://').rstrip('/')}/api/v1"

    def test(self, http: Http, creds: dict[str, str], config: dict[str, str], mapping: dict[str, str]) -> Outcome:
        a = http.request("GET", f"{self._base(config)}/leads", headers=self._h(creds), query={"per_page": "1"})   # verify with a real account
        return done("skipped", a.status) if a.ok else failed(a)

    def push(self, http: Http, creds: dict[str, str], config: dict[str, str], mapping: dict[str, str], rec: Record) -> Outcome:
        if not rec.phone and not rec.email:
            return done("skipped")
        base, h = self._base(config), self._h(creds)
        a = http.request("POST", f"{base}/leads", headers=h, json_body=dict(mapped_fields(rec, mapping)))   # Sell.Do de-duplicates and assigns on its own (vendor page)
        if not a.ok:
            return failed(a)
        lead = first_id(dig(a.body, "lead_id") or dig(a.body, "id"))
        if not lead:
            return Outcome(False, "bad_answer", a.status)
        word = "created" if a.status == 201 else "updated"
        if has_note(rec, mapping):
            n = http.request("POST", f"{base}/leads/{lead}/notes", headers=h, json_body={"note": note_text(rec, mapping)})   # verify with a real account
            if not n.ok:
                return failed(n)
            word = "noted"
        return done(word, a.status)
