"""An in-memory double for the lead sources (job DR / A2; no database). It follows the same rules as app.lead_intake_core in the same words, only far simpler: the database's own behaviour is proved by
supabase/tests/database/128_dr_lead_sources.test.sql."""

# ruff: noqa: E501

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import UTC, datetime
from typing import Any

from app.crm.repository import ConflictError, NotFoundError
from app.lead_sources.phones import check_phone


class FakeLeadSourcesRepository:
    def __init__(self, *, gate_closed: bool = False) -> None:
        self.gate_closed = gate_closed
        self.contacts: dict[str, dict[str, Any]] = {}
        self.items: set[tuple[str, str]] = set()
        self.parts: dict[str, dict[str, Any]] = {}
        self.consents: dict[str, dict[str, Any]] = {}
        self.sources_: dict[str, dict[str, Any]] = {}
        self.by_hash: dict[str, str] = {}
        self.unparsed_: list[dict[str, Any]] = []
        self.links: dict[str, dict[str, Any]] = {}
        self.calls: list[str] = []
        self.sent: list[dict[str, Any]] = []     # every row the API sent to the database
        self.hits = 0
        self.rate_after = 1000
        self.window_end = "2026-10-27T10:00:00+00:00"
        self.stats: dict[str, Any] = {}       # job EB: what lead_source_cards_stats would return
        self.inbound: dict[str, Any] = {}     # job EB: the forwarding address token of the workspace
        self.website: dict[str, Any] = {}     # job EK: the website form token of the workspace

    # the core, simplified
    def _core(self, tag: str, consent: str | None, rows: list[dict[str, Any]], live: bool, dry: bool) -> dict[str, Any]:
        counts = {"ready": 0, "duplicates_merged": 0, "already_imported": 0, "invalid": 0, "dnd": 0, "no_consent": 0, "blocked": 0}
        problems: list[dict[str, Any]] = []
        staged_contacts = dict(self.contacts)
        staged_items = set(self.items)
        for i, r in enumerate(rows, start=1):
            self.sent.append(r)
            phone = check_phone(r.get("phone"))
            if phone.stored is None and not r.get("email"):
                counts["invalid"] += 1
                problems.append({"row": i, "reason": "invalid_number" if r.get("phone") else "no_contact_way"})
                continue
            ext = r.get("external_id") or (f"h:{hashlib.sha256((str(phone.key) + str(r.get('message'))).encode()).hexdigest()[:12]}" if live else None)
            if ext and (tag, ext) in staged_items:
                counts["already_imported"] += 1
                problems.append({"row": i, "reason": "already_imported"})
                continue
            if self.gate_closed and phone.stored and not phone.stored.startswith("+00"):
                counts["blocked"] += 1
                problems.append({"row": i, "reason": "real_data_gate"})
                continue
            key = phone.key or str(r.get("email"))
            if key in staged_contacts:
                counts["duplicates_merged"] += 1
            else:
                counts["ready"] += 1
                staged_contacts[key] = {"name": r.get("name"), "phone": phone.stored, "email": r.get("email"), "tag": tag, "consent": consent, "keys": r.get("keys")}
            if r.get("dnd"):
                counts["dnd"] += 1
            if consent is None:
                counts["no_consent"] += 1
            if ext:
                staged_items.add((tag, ext))
        if not dry:
            self.contacts, self.items = staged_contacts, staged_items
        return {"counts": counts, "problems": problems[:50]}

    # people
    def consent_confirm(self, token: str, tenant_id: uuid.UUID, consent_id: uuid.UUID, consent: dict[str, Any]) -> dict[str, Any]:
        self.calls.append("consent_confirm")
        self.consents[str(consent_id)] = consent
        return {"id": str(consent_id), **consent}

    def intake_apply(self, token: str, tenant_id: uuid.UUID, args: dict[str, Any]) -> dict[str, Any]:
        self.calls.append("intake_apply")
        sha = hashlib.sha256(json.dumps([args["p_rows"], args["p_tag"], args["p_consent_id"]], sort_keys=True, default=str).encode()).hexdigest()
        prior = self.parts.get(args["p_intake_id"])
        if not args["p_dry_run"] and prior is not None:
            if prior["sha"] != sha:
                raise ConflictError("23505")
            return {"replayed": True, "counts": prior["out"]["counts"], "problems": prior["out"]["problems"], "rows_read": len(args["p_rows"])}
        consent = args["p_consent_id"] or ("assumed" if args["p_dry_run"] and args.get("p_assume_consent") else None)
        out = self._core(args["p_tag"], consent, args["p_rows"], False, args["p_dry_run"])
        if not args["p_dry_run"]:
            self.parts[args["p_intake_id"]] = {"sha": sha, "out": out, "import_id": args["p_import_id"], "kind": args["p_kind"], "tag": args["p_tag"], "consent": args["p_consent_id"], "rows": len(args["p_rows"]), "cost": args["p_cost_paise"], "at": datetime.now(UTC).isoformat()}
        return {"replayed": False, **out, "rows_read": len(args["p_rows"])}

    def intakes(self, token: str, tenant_id: uuid.UUID, limit: int, before: datetime | None) -> list[dict[str, Any]]:
        by_import: dict[str, dict[str, Any]] = {}
        for v in self.parts.values():
            row = by_import.setdefault(v["import_id"], {"import_id": v["import_id"], "kind": v["kind"], "source": v["tag"], "consent_id": v["consent"], "rows_read": 0, "created_at": v["at"], "by": "Owner", "counts": {}, "problems": []})
            row["rows_read"] += v["rows"]
            for k, n in v["out"]["counts"].items():
                row["counts"][k] = row["counts"].get(k, 0) + n
        return list(by_import.values())[:limit]

    def source_create(self, token: str, tenant_id: uuid.UUID, args: dict[str, Any]) -> dict[str, Any]:
        self.calls.append("source_create")
        sid = args["p_id"]
        if sid in self.sources_:
            return {"created": False, "source": self._src(sid)}
        self.sources_[sid] = {"id": sid, "kind": args["p_kind"], "tag": args["p_tag"], "label": args["p_label"], "status": "active", "token_hash": args["p_token_hash"], "token_hint": args["p_token_hint"], "consent_id": args["p_consent_id"] if args["p_consent"] else None, "received_count": 0}
        if args["p_token_hash"]:
            self.by_hash[args["p_token_hash"]] = sid
        if args["p_consent"]:
            self.consents[args["p_consent_id"]] = args["p_consent"]
        return {"created": True, "source": self._src(sid)}

    def _src(self, sid: str) -> dict[str, Any]:
        s = self.sources_[sid]
        return {"id": s["id"], "kind": s["kind"], "tag": s["tag"], "label": s["label"], "status": s["status"], "created_at": "2026-10-27T10:00:00+00:00", "last_received_at": None, "received_count": s["received_count"], "token_hint": s["token_hint"], "cost_per_lead_paise": None, "consent_confirmed": bool(s["consent_id"]), "consent_id": s["consent_id"]}

    def sources(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        return [self._src(s) for s in self.sources_]

    def source_rotate(self, token: str, tenant_id: uuid.UUID, source_id: uuid.UUID, token_hash: str, hint: str) -> dict[str, Any]:
        s = self.sources_.get(str(source_id))
        if s is None or s["kind"] == "indiamart":
            raise NotFoundError("23503")
        self.by_hash.pop(s["token_hash"], None)
        s["token_hash"], s["token_hint"] = token_hash, hint
        self.by_hash[token_hash] = str(source_id)
        return self._src(str(source_id))

    def source_status(self, token: str, tenant_id: uuid.UUID, source_id: uuid.UUID, status: str) -> dict[str, Any]:
        if str(source_id) not in self.sources_:
            raise NotFoundError("23503")
        self.sources_[str(source_id)]["status"] = status
        return self._src(str(source_id))

    def unparsed(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        return [{"id": str(u["id"]), "source_id": u["source_id"], "received_at": "2026-10-27T10:00:00+00:00", "subject": u["subject"], "preview": u["body"][:300]} for u in self.unparsed_ if not u.get("discarded")]

    def unparsed_discard(self, token: str, tenant_id: uuid.UUID, item_id: uuid.UUID) -> bool:
        for u in self.unparsed_:
            if str(u["id"]) == str(item_id):
                u["discarded"] = True
                return True
        raise NotFoundError("23503")

    def arrivals(self, token: str, tenant_id: uuid.UUID, lead_id: uuid.UUID) -> dict[str, Any]:
        return {"items": [{"at": "2026-10-27T10:00:00+00:00", "kind": "first", "source": "webhook", "message": "Need a flat"}], "flags": ["dnd"]}

    def sheet_link_create(self, token: str, tenant_id: uuid.UUID, args: dict[str, Any]) -> dict[str, Any]:
        lid = args["p_id"]
        self.links[lid] = {"id": lid, "status": "active", "source": "google_sheet", "last_synced_at": None, "last_row_count": None, "last_result": None, "last_error": None, "created_at": "2026-10-27T10:00:00+00:00", "next_sync_at": "2026-10-27T10:15:00+00:00", "sheet_id": args["p_sheet_id"], "gid": args["p_gid"], "mapping": args["p_mapping"], "header_sha": args["p_header_sha"], "args": args}
        return {k: v for k, v in self.links[lid].items() if k not in ("sheet_id", "gid", "mapping", "header_sha", "args")}

    def sheet_links(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        return [{k: v for k, v in link.items() if k not in ("sheet_id", "gid", "mapping", "header_sha", "args")} for link in self.links.values()]

    def sheet_link_action(self, token: str, tenant_id: uuid.UUID, link_id: uuid.UUID, action: str) -> dict[str, Any]:
        link = self.links.get(str(link_id))
        if link is None:
            raise NotFoundError("23503")
        link["status"] = {"pause": "paused", "resume": "active", "sync_now": "active"}[action]
        if action == "sync_now":
            link["last_synced_at"] = None
        return {k: v for k, v in link.items() if k not in ("sheet_id", "gid", "mapping", "header_sha", "args")}

    # the registered worker account
    def live(self, worker_token: str, token_hash: str, rows: list[dict[str, Any]]) -> dict[str, Any]:
        self.calls.append("live")
        sid = self.by_hash.get(token_hash)
        if sid is None or self.sources_[sid]["status"] != "active":
            return {"status": "unknown"}
        self.hits += 1
        if self.hits > self.rate_after:
            return {"status": "rate"}
        out = self._core(self.sources_[sid]["tag"], self.sources_[sid]["consent_id"], rows, True, False)
        self.sources_[sid]["received_count"] += out["counts"]["ready"] + out["counts"]["duplicates_merged"]
        return {"status": "received", "counts": out["counts"]}

    def unparsed_add(self, worker_token: str, token_hash: str, subject: str | None, body: str) -> dict[str, Any]:
        sid = self.by_hash.get(token_hash)
        if sid is None or self.sources_[sid]["kind"] != "email_forward":
            return {"status": "unknown"}
        self.unparsed_.append({"id": uuid.uuid4(), "source_id": sid, "subject": subject, "body": body})
        return {"status": "kept"}

    def sheets_due(self, worker_token: str, limit: int) -> list[dict[str, Any]]:
        return [{"id": k["id"], "sheet_id": k["sheet_id"], "gid": k["gid"], "mapping": k["mapping"], "header_sha": k["header_sha"]} for k in self.links.values() if k["status"] == "active" and k["last_synced_at"] is None][:limit]

    def sheet_apply(self, worker_token: str, link_id: uuid.UUID, rows: list[dict[str, Any]], header_sha: str) -> dict[str, Any]:
        link = self.links[str(link_id)]
        if link["header_sha"] != header_sha:
            link["status"], link["last_error"], link["last_synced_at"] = "needs_attention", "columns_changed", "2026-10-27T10:30:00+00:00"
            return {"status": "columns_changed"}
        out = self._core("google_sheet", link["args"]["p_consent_id"], rows, False, False) if rows else {"counts": {}}
        link["last_synced_at"], link["last_row_count"], link["last_result"], link["last_error"] = "2026-10-27T10:30:00+00:00", len(rows), out["counts"], None
        return {"status": "done", "counts": out["counts"]}

    def sheet_failed(self, worker_token: str, link_id: uuid.UUID, error: str) -> bool:
        link = self.links[str(link_id)]
        link["last_synced_at"], link["last_error"] = "2026-10-27T10:30:00+00:00", error
        if error in ("sheet_not_public", "too_large"):
            link["status"] = "needs_attention"
        return True

    # job EB part B: the Sources page
    def cards_stats(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        self.calls.append("cards_stats")
        return self.stats

    def inbound_get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return dict(self.inbound) if self.inbound else {"token": None, "source_id": None}

    def inbound_set(self, token: str, tenant_id: uuid.UUID, source_id: uuid.UUID, address_token: str) -> dict[str, Any]:
        self.calls.append("inbound_set")
        self.inbound = {"token": address_token, "source_id": str(source_id)}
        return self.inbound

    def website_get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return dict(self.website) if self.website else {"token": None, "source_id": None}

    def website_set(self, token: str, tenant_id: uuid.UUID, source_id: uuid.UUID, form_token: str) -> dict[str, Any]:
        self.calls.append("website_set")
        self.website = {"token": form_token, "source_id": str(source_id)}
        return self.website


class Receiver:
    """The registered worker account's session, as the API sees it."""

    def token(self) -> str:
        return "worker-token"
