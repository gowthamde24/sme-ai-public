"""Airtable (personal access token, base and table). One row per event, written with an upsert on the 'Stack19 ref' column, so the same event twice is one row. Docs: docs/contracts/crm-push.md."""

# ruff: noqa: E501

from __future__ import annotations

import re
from urllib.parse import quote

from app.crm_push.adapters.base import Adapter, Outcome, Setting, Spec, dig, done, failed
from app.crm_push.fields import ROW_FIELDS, Record
from app.crm_push.transport import Http

BASE = "https://api.airtable.com/v0"
_BASE_ID = re.compile(r"app[A-Za-z0-9]{10,20}")
_TABLE = re.compile(r"(tbl[A-Za-z0-9]{10,20}|[A-Za-z0-9][A-Za-z0-9 _.-]{0,79})")
COLUMNS = {"name": "Name", "phone": "Phone", "email": "Email", "source": "Source", "outcome": "Result", "summary": "Summary", "captured": "Details", "duration": "Duration (seconds)", "call_id": "Call", "event": "Event", "ref": "Stack19 ref"}


class Airtable(Adapter):
    spec = Spec(
        key="airtable", label="Airtable", kind="key",
        credentials=(Setting("token", "Personal access token", secret=True, help="Airtable: Builder hub, Personal access tokens. Scopes: read and write records, read the base's structure; give it this base."),),
        settings=(Setting("base_id", "Base id", help="Starts with app. It is in the address of your base.", example="appXXXXXXXXXXXXXX"), Setting("table", "Table name", help="The table the rows go to.", example="Leads")),
        targets=tuple((v, v) for v in COLUMNS.values()),
        our_fields=ROW_FIELDS,
        default_mapping=dict(COLUMNS),
        notes=False,
        docs=("https://airtable.com/developers/web/api/create-records", "https://airtable.com/developers/web/api/update-multiple-records", "https://airtable.com/developers/web/api/get-base-schema", "https://airtable.com/developers/web/api/rate-limits", "https://airtable.com/developers/web/api/errors"),
        verify=("records per request (10, from memory; we send one)", "the specific 422 error names"),
        setup_steps=("In Airtable open the Builder hub, Personal access tokens, and make a token.", "Give it: read records, write records, read the base's structure, and add this base.", "Make the columns in your table (the mapping below lists them), then paste the token, the base id and the table name here."),
    )

    def check(self, creds: dict[str, str], config: dict[str, str]) -> str | None:
        return None if _BASE_ID.fullmatch(config.get("base_id", "")) and _TABLE.fullmatch(config.get("table", "")) else "config"

    @staticmethod
    def _h(creds: dict[str, str]) -> dict[str, str]:
        return {"Authorization": f"Bearer {creds['token']}"}

    def test(self, http: Http, creds: dict[str, str], config: dict[str, str], mapping: dict[str, str]) -> Outcome:
        a = http.request("GET", f"{BASE}/meta/bases/{config['base_id']}/tables", headers=self._h(creds))
        if not a.ok:
            return failed(a)
        tables = dig(a.body, "tables")
        table = next((t for t in tables if isinstance(t, dict) and config["table"] in (t.get("id"), t.get("name"))), None) if isinstance(tables, list) else None
        if table is None:
            return Outcome(False, "not_found", a.status)
        have = {f.get("name") for f in table.get("fields", []) if isinstance(f, dict)}
        if any(col and col not in have for col in mapping.values()):
            return Outcome(False, "config", a.status)   # a column of the mapping is not in that table
        return done("skipped", a.status)

    def push(self, http: Http, creds: dict[str, str], config: dict[str, str], mapping: dict[str, str], rec: Record) -> Outcome:
        fields = {col: rec.value(key) for key in ROW_FIELDS if (col := mapping.get(key)) and rec.value(key)}
        if not fields or rec.value("name") + rec.value("phone") + rec.value("email") == "":
            return done("skipped")
        url = f"{BASE}/{config['base_id']}/{quote(config['table'], safe='')}"
        ref_col = mapping.get("ref")
        if ref_col:
            a = http.request("PATCH", url, headers=self._h(creds), json_body={"performUpsert": {"fieldsToMergeOn": [ref_col]}, "typecast": True, "records": [{"fields": fields}]})
        else:
            a = http.request("POST", url, headers=self._h(creds), json_body={"typecast": True, "records": [{"fields": fields}]})
        if not a.ok:
            return failed(a)
        if dig(a.body, "updatedRecords", 0):
            return done("updated", a.status)
        if dig(a.body, "records", 0):
            return done("created", a.status)
        return Outcome(False, "bad_answer", a.status)
