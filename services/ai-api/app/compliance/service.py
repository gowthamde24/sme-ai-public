"""The thin layer over the database functions of migration 20261231992610. The rules (who may, the age limits, the counts) are the database's and the call gate's; nothing here decides them."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from typing import Any

from app.rpc_base import RpcClient

REGISTRAR_ID = r"^[A-Za-z0-9._#/-]{4,96}$"   # what a Consent Registrar id looks like (kept as evidence `registrar:<id>`; the shape is the evidence column's own)


class ComplianceService:
    def __init__(self, rpc: RpcClient) -> None:
        self._rpc = rpc

    def usage_ack(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "number_usage_ack_get", {"p_tenant_id": str(tenant_id)})

    def accept_usage(self, token: str, tenant_id: uuid.UUID, version: str) -> dict[str, Any]:
        return self._rpc.object(token, "number_usage_ack_accept", {"p_tenant_id": str(tenant_id), "p_version": version})

    def register_consent(self, token: str, tenant_id: uuid.UUID, contact_id: uuid.UUID, registrar_id: str) -> None:
        """A phone consent that a Consent Registrar holds: stored as an ordinary granted consent event whose evidence is `registrar:<id>`, so every existing consent rule keeps working."""
        self._rpc.call(token, "record_consent", {"p_tenant_id": str(tenant_id), "p_contact_id": str(contact_id), "p_channel": "phone", "p_status": "granted", "p_basis": "explicit_consent",
                                                 "p_evidence_type": "other", "p_evidence_ref": f"registrar:{registrar_id}"})

    def record_complaint(self, token: str, tenant_id: uuid.UUID, kind: str, call_id: uuid.UUID | None) -> dict[str, Any]:
        return self._rpc.object(token, "call_complaint_record", {"p_tenant_id": str(tenant_id), "p_kind": kind, "p_call_id": str(call_id) if call_id else None})

    def abandoned_calls(self, token: str, hours: int) -> dict[str, Any]:
        return self._rpc.object(token, "admin_abandoned_calls", {"p_hours": hours})
