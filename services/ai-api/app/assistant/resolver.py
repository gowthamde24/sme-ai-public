"""Turns the stored (type, id) pairs of a message into labelled sources and draft cards, READ FRESH with the caller's own rights. A name is never stored with the pair, so
an erased or archived record shows as "(no longer available)" and nothing else survives of it."""

from __future__ import annotations

import uuid
from typing import Any

from app.assistant.db import AssistantDb
from app.assistant.models import DraftCardOut, SourceOut, draft_summary

GONE = "(no longer available)"


def _in(ids: list[uuid.UUID]) -> str:
    return "in.(" + ",".join(str(i) for i in ids) + ")"


def _customer(row: dict[str, Any]) -> str:
    return str(((row.get("lead") or {}).get("company") or {}).get("name") or "a customer")


def _labels(
    db: AssistantDb, wanted: dict[str, list[uuid.UUID]]
) -> dict[tuple[str, uuid.UUID], tuple[str, tuple[str, uuid.UUID] | None, dict[str, Any]]]:
    """(type, id) -> (label, open target, extra) for what the caller can still read."""
    out: dict[tuple[str, uuid.UUID], tuple[str, tuple[str, uuid.UUID] | None, dict[str, Any]]] = {}

    def rows(what: str, path: str, select: str, ids: list[uuid.UUID]) -> list[dict[str, Any]]:
        if not ids:
            return []
        return db.rest_rows(what, path, {"select": select, "id": _in(ids)})

    for r in rows(
        "labels_quotes",
        "/quotes",
        "id,quote_no,status,lead:leads(company:companies(name))",
        wanted.get("quote", []),
    ):
        q = uuid.UUID(str(r["id"]))
        out[("quote", q)] = (f"Quote {r['quote_no']} for {_customer(r)}", ("quote", q), {})
    for r in rows(
        "labels_orders",
        "/orders",
        "id,order_no,lead:leads(company:companies(name))",
        wanted.get("order", []),
    ):
        o = uuid.UUID(str(r["id"]))
        out[("order", o)] = (f"Order {r['order_no']} for {_customer(r)}", ("order", o), {})
    for r in rows("labels_leads", "/leads", "id,company:companies(name)", wanted.get("lead", [])):
        lid = uuid.UUID(str(r["id"]))
        out[("lead", lid)] = (
            f"{(r.get('company') or {}).get('name') or 'A customer'} (lead)",
            ("lead", lid),
            {},
        )
    for r in rows("labels_companies", "/companies", "id,name", wanted.get("company", [])):
        out[("company", uuid.UUID(str(r["id"])))] = (str(r["name"]), None, {})
    for r in rows(
        "labels_enquiries",
        "/enquiries",
        "id,received_at,lead:leads(company:companies(name))",
        wanted.get("enquiry", []),
    ):
        e = uuid.UUID(str(r["id"]))
        out[("enquiry", e)] = (
            f"Enquiry from {_customer(r)} on {str(r['received_at'])[:10]}",
            ("enquiry", e),
            {},
        )
    for r in rows("labels_items", "/price_list_items", "id,name,sku", wanted.get("price_item", [])):
        out[("price_item", uuid.UUID(str(r["id"])))] = (f"{r['name']} ({r['sku']})", None, {})
    for r in rows(
        "labels_followups",
        "/followup_drafts",
        "id,touch_number,lead_id,lead:leads(company:companies(name))",
        wanted.get("followup_draft", []),
    ):
        d = uuid.UUID(str(r["id"]))
        out[("followup_draft", d)] = (
            f"Follow-up {r['touch_number']} for {_customer(r)}",
            ("lead", uuid.UUID(str(r["lead_id"]))),
            {},
        )
    for r in rows(
        "labels_replies",
        "/assistant_reply_drafts",
        "id,language,body,gloss_en,lead_id,enquiry_id",
        wanted.get("reply_draft", []),
    ):
        d = uuid.UUID(str(r["id"]))
        target = (
            ("enquiry", uuid.UUID(str(r["enquiry_id"])))
            if r.get("enquiry_id")
            else ("lead", uuid.UUID(str(r["lead_id"])))
        )
        out[("reply_draft", d)] = (
            "Reply draft (machine-written)",
            target,
            {"language": r["language"], "preview": r["body"], "gloss_en": r["gloss_en"]},
        )
    return out


def _open(target: tuple[str, uuid.UUID] | None) -> dict[str, Any] | None:
    return {"type": target[0], "id": target[1]} if target else None


def resolve(
    db: AssistantDb, sources: list[dict[str, str]], drafts: list[dict[str, str]]
) -> tuple[list[SourceOut], list[DraftCardOut]]:
    wanted: dict[str, list[uuid.UUID]] = {}
    for pair in (*sources, *drafts):
        wanted.setdefault(pair["type"], []).append(uuid.UUID(pair["id"]))
    found = _labels(db, wanted)
    src: list[SourceOut] = []
    for pair in sources:
        key = (pair["type"], uuid.UUID(pair["id"]))
        label, target, _ = found.get(key, (GONE, None, {}))
        src.append(
            SourceOut.model_validate(
                {"kind": key[0], "id": key[1], "label": label, "target": _open(target)}
            )
        )
    cards: list[DraftCardOut] = []
    for pair in drafts:
        key = (pair["type"], uuid.UUID(pair["id"]))
        label, target, extra = found.get(key, (GONE, None, {}))
        cards.append(
            DraftCardOut.model_validate(
                {
                    "id": key[1],
                    "kind": key[0],
                    "title": label,
                    "summary": draft_summary(key[0], extra.get("preview"))
                    if key in found
                    else GONE,
                    "target": _open(target),
                    "language": extra.get("language"),
                    "gloss_en": extra.get("gloss_en"),
                    "machine_draft": pair["type"] == "reply_draft" and key in found,
                }
            )
        )
    return src, cards
