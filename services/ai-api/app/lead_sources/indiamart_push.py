"""IndiaMART's Push API (documented by IndiaMART, help.indiamart.com: "Integration of IndiaMART's Lead Manager CRM Push API with Third Party CRMs - Real-time Push of Leads"). The seller opens seller.indiamart.com, Lead Manager,
Import/Export Leads, the three dots, Push API, picks "Other" and pastes a web address (https only); IndiaMART then POSTs each new lead there as JSON the moment it arrives and treats an HTTP 200 as "received".
The address of one of our web-address lead sources (kind webhook) is that web address; like every lead address it is the credential, IndiaMART sends no key of its own.

The body is `{"CODE": 200, "STATUS": "SUCCESS", "RESPONSE": {"UNIQUE_QUERY_ID": ..., "SENDER_NAME": ..., "SENDER_MOBILE": ..., ...}}`. IndiaMART's own page also shows the call wrapped (an outer object with the body inside it), so both shapes
are read, and `RESPONSE` may be one lead or a list. The same field names as the pull API (app/connectors/indiamart.py) are read by the same function, so a lead is understood the same way however it arrives.
The buyer's message is untrusted text and is only ever stored as the enquiry's words. Switch INDIAMART_PUSH (off by default): off, this shape is not recognised and the post is read like any other form."""

from __future__ import annotations

import json
from typing import Any

from app.connectors.indiamart import lead_of

MAX_LEADS = 20


def _inner(data: dict[str, Any]) -> object:
    if "RESPONSE" in data:
        return data["RESPONSE"]
    body = data.get("body") or data.get("Body")
    if isinstance(body, str):
        try:
            body = json.loads(body)
        except ValueError:
            return None
    if isinstance(body, dict):
        return body.get("RESPONSE")
    return None


def is_push(data: dict[str, Any]) -> bool:
    inner = _inner(data)
    return isinstance(inner, (dict, list)) and bool(inner)


def rows_of(data: dict[str, Any]) -> list[dict[str, Any]]:
    """The leads of one push as rows for the intake (at most 20), each tagged `indiamart`; a row IndiaMART sent without an id or without a mobile and an e-mail is left out."""
    # here, not at the top: that module reaches the whole app, which imports the lead sources
    from app.lead_sources.indiamart import row_of

    inner = _inner(data)
    items = [inner] if isinstance(inner, dict) else [x for x in inner if isinstance(x, dict)] if isinstance(inner, list) else []
    rows: list[dict[str, Any]] = []
    for item in items[:MAX_LEADS]:
        lead = lead_of(item)
        if lead is None:
            continue
        row = row_of(lead)
        city = item.get("SENDER_CITY")
        if isinstance(city, str) and city.strip():
            row["city"] = city.strip()[:100]
        row["tag"] = "indiamart"
        rows.append(row)
    return rows
