"""Notion (internal integration token and a database shared with it). One page per event. The database is read once per push (its data source and the type of each property), the page is written in each property's own type, and an event whose Ref is already there
is not written again. Docs: docs/contracts/crm-push.md."""

# ruff: noqa: E501

from __future__ import annotations

import re
from typing import Any

from app.crm_push.adapters.base import Adapter, Outcome, Setting, Spec, dig, done, failed
from app.crm_push.fields import ROW_FIELDS, Record
from app.crm_push.transport import Answer, Http

BASE = "https://api.notion.com/v1"
VERSION = "2025-09-03"   # data sources arrived in this version; 2026-03-11 changes nothing these calls use
_DB = re.compile(r"[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
COLUMNS = {"name": "Name", "phone": "Phone", "email": "Email", "source": "Source", "outcome": "Result", "summary": "Summary", "captured": "Details", "duration": "Duration (seconds)", "call_id": "Call", "event": "Event", "ref": "Stack19 ref"}


def _rich(text: str) -> list[dict[str, Any]]:
    return [{"type": "text", "text": {"content": text[:2000]}}]


def _value(kind: str, text: str) -> dict[str, Any] | None:
    """One property in its own type, or None when we cannot write that type (it is left out)."""
    if kind == "title":
        return {"title": _rich(text)}
    if kind == "rich_text":
        return {"rich_text": _rich(text)}
    if kind == "phone_number":
        return {"phone_number": text[:200]}
    if kind == "email":
        return {"email": text[:200]}
    if kind == "url":
        return {"url": text[:2000]}
    if kind == "select":
        return {"select": {"name": text.replace(",", " ")[:100]}}
    if kind == "number":
        try:
            return {"number": float(text) if "." in text else int(text)}
        except ValueError:
            return None
    return None


class Notion(Adapter):
    spec = Spec(
        key="notion", label="Notion", kind="key",
        credentials=(Setting("token", "Integration token", secret=True, help="Notion: Settings, Connections, Develop or manage integrations: an internal integration."),),
        settings=(Setting("database_id", "Database id", help="The long code in the address of your database.", example="0123456789abcdef0123456789abcdef"),),
        targets=tuple((v, v) for v in COLUMNS.values()),
        our_fields=ROW_FIELDS,
        default_mapping=dict(COLUMNS),
        notes=False,
        docs=("https://developers.notion.com/reference/post-page", "https://developers.notion.com/reference/query-a-data-source", "https://developers.notion.com/reference/retrieve-a-data-source", "https://developers.notion.com/reference/page-property-values",
              "https://developers.notion.com/reference/request-limits", "https://developers.notion.com/docs/upgrade-guide-2025-09-03"),
        verify=("updating an existing page is not done (an event is written once)", "the 3 requests a second limit on small plans (a busy day may slow a push)"),
        setup_steps=("In Notion make an internal integration and copy its token.", "Open your database, the ... menu, Connections, and add the integration.", "Make the properties of the mapping below in the database, then paste the token and the database id here."),
    )

    def check(self, creds: dict[str, str], config: dict[str, str]) -> str | None:
        return None if _DB.fullmatch(config.get("database_id", "").strip().lower()) else "config"

    @staticmethod
    def _h(creds: dict[str, str]) -> dict[str, str]:
        return {"Authorization": f"Bearer {creds['token']}", "Notion-Version": VERSION}

    def _schema(self, http: Http, creds: dict[str, str], config: dict[str, str]) -> tuple[str, dict[str, str]] | Answer | Outcome:
        db = http.request("GET", f"{BASE}/databases/{config['database_id'].strip().lower()}", headers=self._h(creds))
        if not db.ok:
            return db
        source = dig(db.body, "data_sources", 0, "id")
        if not isinstance(source, str):
            return Outcome(False, "bad_answer", db.status)
        ds = http.request("GET", f"{BASE}/data_sources/{source}", headers=self._h(creds))
        if not ds.ok:
            return ds
        props = dig(ds.body, "properties")
        if not isinstance(props, dict):
            return Outcome(False, "bad_answer", ds.status)
        return source, {name: str(p.get("type")) for name, p in props.items() if isinstance(p, dict)}

    def test(self, http: Http, creds: dict[str, str], config: dict[str, str], mapping: dict[str, str]) -> Outcome:
        got = self._schema(http, creds, config)
        if isinstance(got, Answer):
            return failed(got)
        if isinstance(got, Outcome):
            return got
        types = got[1]
        if any(col and col not in types for col in mapping.values()):
            return Outcome(False, "config")   # a property of the mapping is not in that database
        return done("skipped")

    def push(self, http: Http, creds: dict[str, str], config: dict[str, str], mapping: dict[str, str], rec: Record) -> Outcome:
        if not any(rec.value(k) for k in ("name", "phone", "email")):
            return done("skipped")
        got = self._schema(http, creds, config)
        if isinstance(got, Answer):
            return failed(got)
        if isinstance(got, Outcome):
            return got
        source, types = got
        h = self._h(creds)
        ref_col = mapping.get("ref")
        if ref_col and types.get(ref_col) == "rich_text":
            q = http.request("POST", f"{BASE}/data_sources/{source}/query", headers=h, json_body={"filter": {"property": ref_col, "rich_text": {"equals": rec.event_id}}, "page_size": 1})
            if not q.ok:
                return failed(q)
            if dig(q.body, "results", 0):
                return done("skipped", q.status)   # this event is already there
        props: dict[str, Any] = {}
        for key in ROW_FIELDS:
            col = mapping.get(key)
            text = rec.value(key)
            if col and text and col in types and (val := _value(types[col], text)) is not None:
                props[col] = val
        title = next((n for n, t in types.items() if t == "title"), None)
        if title and title not in props:
            props[title] = _value("title", rec.name or rec.phone or rec.email) or {}
        a = http.request("POST", f"{BASE}/pages", headers=h, json_body={"parent": {"type": "data_source_id", "data_source_id": source}, "properties": props})
        return done("created", a.status) if a.ok else failed(a)
