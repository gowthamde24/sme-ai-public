"""LeadSquared (access key, secret key and the account's API host). One call makes or changes the lead (Lead.CreateOrUpdate, matched by phone, else e-mail), a second adds a note (CreateNote: no activity code is needed). Docs: docs/contracts/crm-push.md."""

# ruff: noqa: E501

from __future__ import annotations

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
    first_id,
)
from app.crm_push.fields import Record, has_note, mapped_fields, note_text, split_name
from app.crm_push.transport import Http

_HOST = re.compile(r"api(-[a-z]{2}\d{2})?\.leadsquared\.com")


class LeadSquared(Adapter):
    spec = Spec(
        key="leadsquared", label="LeadSquared", kind="key",
        credentials=(Setting("access_key", "Access key", secret=True), Setting("secret_key", "Secret key", secret=True)),
        settings=(Setting("host", "API host", help="Shown next to your keys. Different for each region.", example="api-in21.leadsquared.com"),),
        targets=(("FirstName", "First name"), ("LastName", "Last name"), ("Phone", "Phone"), ("Mobile", "Mobile"), ("EmailAddress", "Email"), ("Source", "Lead source")),
        default_mapping=default_note_mapping({"name": "FirstName", "phone": "Phone", "email": "EmailAddress", "source": "Source"}),
        docs=("https://apidocs.leadsquared.com/authentication/", "https://apidocs.leadsquared.com/api-host/", "https://apidocs.leadsquared.com/create-or-update/", "https://apidocs.leadsquared.com/create-notes-with-attachment/", "https://apidocs.leadsquared.com/quick-search/"),
        verify=("the test call (LeadsMetaData.Get answer)", "whether Source takes any text or needs an existing value", "whether a created and a changed lead can be told apart in the answer (both are sent as updated)"),
        setup_steps=("In LeadSquared open My Account, Settings, API and Webhooks.", "Copy the Access key, the Secret key and the API host (it looks like api-in21.leadsquared.com)."),
    )

    def check(self, creds: dict[str, str], config: dict[str, str]) -> str | None:
        return None if _HOST.fullmatch(config.get("host", "").strip().lower()) else "config"

    @staticmethod
    def _h(creds: dict[str, str]) -> dict[str, str]:
        return {"x-LSQ-AccessKey": creds["access_key"], "x-LSQ-SecretKey": creds["secret_key"]}

    @staticmethod
    def _base(config: dict[str, str]) -> str:
        return f"https://{config['host'].strip().lower()}/v2"

    def test(self, http: Http, creds: dict[str, str], config: dict[str, str], mapping: dict[str, str]) -> Outcome:
        a = http.request("GET", f"{self._base(config)}/LeadManagement.svc/LeadsMetaData.Get", headers=self._h(creds), query={"schemaName": "EmailAddress"})
        return done("skipped", a.status) if a.ok else failed(a)

    def push(self, http: Http, creds: dict[str, str], config: dict[str, str], mapping: dict[str, str], rec: Record) -> Outcome:
        if not rec.phone and not rec.email:
            return done("skipped")
        base, h = self._base(config), self._h(creds)
        fields = mapped_fields(rec, mapping)
        if mapping.get("name") == "FirstName" and rec.name:
            fields["FirstName"], last = split_name(rec.name)
            if last:
                fields["LastName"] = last
        phone_attr = mapping.get("phone") or "Phone"
        body = [{"Attribute": k, "Value": v} for k, v in fields.items()]
        body.append({"Attribute": "SearchBy", "Value": phone_attr if rec.phone and phone_attr in fields else "EmailAddress"})
        a = http.request("POST", f"{base}/LeadManagement.svc/Lead.CreateOrUpdate", headers=h, query={"postUpdatedLead": "false"}, json_body=body)
        if not a.ok:
            return failed(a)
        if dig(a.body, "Status") != "Success":
            return Outcome(False, "rejected", a.status)
        lead = first_id(dig(a.body, "Message", "Id"))
        if not lead:
            return Outcome(False, "bad_answer", a.status)
        word = "updated"
        if has_note(rec, mapping):
            n = http.request("POST", f"{base}/LeadManagement.svc/CreateNote", headers=h, json_body={"RelatedProspectId": lead, "Note": note_text(rec, mapping)})
            if not n.ok:
                return failed(n)
            word = "noted"
        return done(word, a.status)
