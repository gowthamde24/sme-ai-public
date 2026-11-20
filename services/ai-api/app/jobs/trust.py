"""The trust pieces of Jobs, slice S1 (jobs contract 1.0 sections 1 and 6, 15.6, 16): the do-not-call list, the FAQs of a job, and the closed refusals the database gives for them.

The database decides every rule (migration 20261231986900): who may, what an entry's reason is, that an entry the customer asked for can never be removed, that an FAQ answer states no price, discount or promise, that a
helper's own name is not a number or a web address. This module only carries the calls (every one with the CALLER's token) and gives each refusal its closed word; nothing here parses or logs what the database said.
The data layer's text is never returned: a refusal is a fixed sentence."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from typing import Any

from app.rpc_base import RpcClient
from app.tenancy.repository import RepositoryError


class JobsRefused(RepositoryError):
    """SM983..SM986: a closed refusal of the trust functions. `.code` is the SQLSTATE."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


# SQLSTATE -> (HTTP status, error code, the fixed sentence). The same words are in the contract (sections 1, 6, 14) and in docs/contracts/error-codes.md.
REFUSALS: dict[str, tuple[int, str, str]] = {
    "SM983": (422, "name_invalid", "A helper's name cannot be only digits, a web address, an e-mail address or a phone number, and has at most 40 characters."),
    "SM984": (422, "faq_not_allowed", "A job answer may not state a price, a discount or a promise."),
    "SM985": (409, "stopped_by_customer", "This customer asked us to stop, so this number cannot be taken off the list. It comes off only when the customer asks to be contacted again."),
    "SM986": (409, "not_removable", "This number stays on the list: only a number you added yourself can be removed."),
}


class TrustStore:
    """The database's door for the trust pieces (RPCs of migration 20261231986900). The database decides who may; the caller's token goes with every call."""

    def __init__(self, rest_url: str, anon_key: str, *, rpc: RpcClient | None = None) -> None:
        self._rpc = rpc or RpcClient(rest_url, anon_key, {code: JobsRefused for code in REFUSALS})

    # ---- the do-not-call list
    def dnc_list(self, token: str, tenant_id: uuid.UUID, *, q: str | None, cursor: str | None, limit: int, include_lifted: bool) -> dict[str, Any]:
        return self._rpc.object(token, "do_not_call_list", {"p_tenant_id": str(tenant_id), "p_q": q, "p_cursor": cursor, "p_limit": limit, "p_include_lifted": include_lifted})

    def dnc_add(self, token: str, tenant_id: uuid.UUID, phone: str, keys: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(token, "do_not_call_add", {"p_tenant_id": str(tenant_id), "p_phone": phone, "p_keys": keys})

    def dnc_remove(self, token: str, tenant_id: uuid.UUID, entry_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "do_not_call_remove", {"p_tenant_id": str(tenant_id), "p_id": str(entry_id)})

    # ---- the FAQs of a job
    def faq_list(self, token: str, tenant_id: uuid.UUID, job_id: uuid.UUID) -> list[dict[str, Any]]:
        return self._rpc.array(token, "job_faq_list", {"p_tenant_id": str(tenant_id), "p_job_id": str(job_id)})

    def faq_add(self, token: str, tenant_id: uuid.UUID, job_id: uuid.UUID, faq_id: uuid.UUID, question: str, answer: str) -> dict[str, Any]:
        return self._rpc.object(token, "job_faq_add", {"p_tenant_id": str(tenant_id), "p_job_id": str(job_id), "p_question": question, "p_answer": answer, "p_id": str(faq_id)})

    def faq_update(self, token: str, tenant_id: uuid.UUID, job_id: uuid.UUID, faq_id: uuid.UUID, question: str | None, answer: str | None) -> dict[str, Any]:
        return self._rpc.object(token, "job_faq_update", {"p_tenant_id": str(tenant_id), "p_job_id": str(job_id), "p_id": str(faq_id), "p_question": question, "p_answer": answer})

    def faq_remove(self, token: str, tenant_id: uuid.UUID, job_id: uuid.UUID, faq_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "job_faq_remove", {"p_tenant_id": str(tenant_id), "p_job_id": str(job_id), "p_id": str(faq_id)})
