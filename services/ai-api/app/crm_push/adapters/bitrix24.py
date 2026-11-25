"""Bitrix24 (an inbound webhook address: the key is inside it). The lead: find by phone or e-mail, make or change, add a timeline comment. Docs: docs/contracts/crm-push.md."""

# ruff: noqa: E501

from __future__ import annotations

import re
from urllib.parse import urlsplit

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
from app.crm_push.fields import Record, has_note, mapped_fields, note_text, split_name
from app.crm_push.transport import Answer, Http
from app.webhooks_out import ssrf

_HOST = re.compile(r"[a-z0-9-]+\.bitrix24\.[a-z]{2,3}(\.[a-z]{2})?")
_PATH = re.compile(r"/rest/\d{1,10}/[A-Za-z0-9]{6,40}/?")
_MULTI = {"phone": "PHONE", "email": "EMAIL"}


class Bitrix24(Adapter):
    spec = Spec(
        key="bitrix24", label="Bitrix24", kind="key",
        credentials=(Setting("webhook_url", "Inbound webhook address", secret=True, help="Bitrix24: Developer resources, Other, Inbound webhook. Give it the CRM permission.", example="https://mycompany.bitrix24.in/rest/1/abcd1234/"),),
        targets=(("NAME", "First name"), ("LAST_NAME", "Last name"), ("PHONE", "Phone"), ("EMAIL", "Email"), ("SOURCE_ID", "Source"), ("COMMENTS", "Comments")),
        default_mapping=default_note_mapping({"name": "NAME", "phone": "PHONE", "email": "EMAIL", "source": ""}),
        docs=("https://apidocs.bitrix24.com/local-integrations/local-webhooks.html", "https://apidocs.bitrix24.com/api-reference/crm/leads/crm-lead-add.html", "https://apidocs.bitrix24.com/api-reference/crm/leads/crm-lead-update.html",
              "https://apidocs.bitrix24.com/api-reference/crm/duplicates/crm-duplicate-find-by-comm.html", "https://apidocs.bitrix24.com/api-reference/crm/timeline/comments/crm-timeline-comment-add.html", "https://apidocs.bitrix24.com/api-reference/common/users/profile.html"),
        verify=("the complete list of cloud domain endings (.com, .in, .eu, .de ... are accepted by pattern)", "that the timeline comment accepts the entity type 'lead' (the docs example uses deal)", "the profile answer", "SOURCE_ID values are portal-specific"),
        setup_steps=("In Bitrix24 open Developer resources, Other, Inbound webhook (an admin may need to switch it on).", "Give it the CRM permission, then copy the webhook address and paste it here."),
    )

    def check(self, creds: dict[str, str], config: dict[str, str]) -> str | None:
        url = creds.get("webhook_url", "").strip()
        try:
            ssrf.check_url(url)
            parts = urlsplit(url)
        except (ssrf.UnsafeUrl, ValueError):
            return "config"
        return None if _HOST.fullmatch((parts.hostname or "").lower()) and _PATH.fullmatch(parts.path) and not parts.query else "config"

    @staticmethod
    def _call(http: Http, creds: dict[str, str], method: str, body: dict[str, object] | None = None) -> Answer:
        base = creds["webhook_url"].strip().rstrip("/")
        return http.request("POST", f"{base}/{method}.json", json_body=body or {})

    def test(self, http: Http, creds: dict[str, str], config: dict[str, str], mapping: dict[str, str]) -> Outcome:
        a = self._call(http, creds, "profile")
        if a.ok and dig(a.body, "result") is None:
            return Outcome(False, "bad_answer", a.status)
        return done("skipped", a.status) if a.ok else failed(a)

    def push(self, http: Http, creds: dict[str, str], config: dict[str, str], mapping: dict[str, str], rec: Record) -> Outcome:
        if not rec.phone and not rec.email:
            return done("skipped")
        fields: dict[str, object] = dict(mapped_fields(rec, mapping))
        if mapping.get("name") == "NAME" and rec.name:
            fields["NAME"], last = split_name(rec.name)
            if last:
                fields["LAST_NAME"] = last
        for ours, key in _MULTI.items():
            if mapping.get(ours) == key and key in fields:
                fields[key] = [{"VALUE": fields[key], "VALUE_TYPE": "WORK"}]
        lead: str | None = None
        for kind, value in (("PHONE", rec.phone), ("EMAIL", rec.email)):
            if not value or lead:
                continue
            f = self._call(http, creds, "crm.duplicate.findbycomm", {"type": kind, "values": [value], "entity_type": "LEAD"})
            if not f.ok:
                return failed(f)
            lead = first_num(dig(f.body, "result", "LEAD", 0))
        if lead:
            a = self._call(http, creds, "crm.lead.update", {"id": int(lead), "fields": fields})
            word = "updated"
            if a.ok and dig(a.body, "result") is not True:
                return Outcome(False, "bad_answer", a.status)
        else:
            fields.setdefault("TITLE", rec.name or rec.phone or rec.email)
            a = self._call(http, creds, "crm.lead.add", {"fields": fields, "params": {"REGISTER_SONET_EVENT": "N"}})
            word = "created"
            lead = first_num(dig(a.body, "result")) if a.ok else None
            if a.ok and not lead:
                return Outcome(False, "bad_answer", a.status)
        if not a.ok:
            return failed(a)
        if has_note(rec, mapping) and lead:
            n = self._call(http, creds, "crm.timeline.comment.add", {"fields": {"ENTITY_ID": int(lead), "ENTITY_TYPE": "lead", "COMMENT": note_text(rec, mapping)}})
            if not n.ok:
                return failed(n)
            word = "noted"
        return done(word, a.status)
