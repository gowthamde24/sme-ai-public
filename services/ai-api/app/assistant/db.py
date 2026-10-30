"""The assistant's door to the database: the agent runtime's AgentDb (reserve the cost, record usage and steps, finish the run) plus the assistant's own definer
functions and the reads of a chat. Same rules as AgentDb: the CALLER's token, the public key, errors classified by SQLSTATE only, no data-layer text anywhere."""

from __future__ import annotations

import uuid
from typing import Any

import httpx

from app.agents.db import AgentDb
from app.agents.errors import AgentDbError, DataLayerUnavailable

CONVERSATION_COLUMNS = "id,created_at,updated_at"
MESSAGE_COLUMNS = "id,role,body,language,sources,drafts,created_at,seq,kind,task_id"


class MessageConflict(AgentDbError):
    """23505: a message id (or a draft id) already used for different content."""

    sqlstate = "23505"


class AssistantDb(AgentDb):
    @staticmethod
    def _classify(what: str, response: httpx.Response) -> AgentDbError:
        try:
            body = response.json()
        except ValueError:
            body = None
        if isinstance(body, dict) and body.get("code") == "23505":
            return MessageConflict()
        return AgentDb._classify(what, response)

    def __repr__(self) -> str:
        return f"AssistantDb(run={self._run})"

    # ---- the definer functions (each proves the role or the run itself)
    def begin_message(
        self,
        *,
        tenant_id: uuid.UUID,
        conversation_id: uuid.UUID,
        message_id: uuid.UUID,
        text: str,
        language: str | None,
        input_sha256: str,
        light: bool = False,
    ) -> dict[str, Any]:
        return self._rpc(
            "assistant_begin_message",
            {
                "p_run_id": str(self._run),
                "p_tenant_id": str(tenant_id),
                "p_conversation_id": str(conversation_id),
                "p_message_id": str(message_id),
                "p_text": text,
                "p_language": language,
                "p_input_sha256": input_sha256,
                "p_light": light,
            },
        )

    def mark_heavy(self) -> None:
        """The router called this turn a data or action turn after the run opened as a light one: it counts against the hourly allowance like any other."""
        self._rpc("assistant_mark_heavy", {"p_run_id": str(self._run)})

    def save_reply(
        self,
        *,
        message_id: uuid.UUID,
        text: str,
        language: str | None,
        sources: list[dict[str, str]],
        drafts: list[dict[str, str]],
    ) -> dict[str, Any]:
        return self._rpc(
            "assistant_save_reply",
            {
                "p_run_id": str(self._run),
                "p_message_id": str(message_id),
                "p_body": text,
                "p_language": language,
                "p_sources": sources,
                "p_drafts": drafts,
            },
        )

    def mark_reply(self, *, message_id: uuid.UUID, kind: str, task_id: uuid.UUID | None) -> dict[str, Any]:
        """Job EA: the type of the reply this run saved (confirm_action, clarify) and the task it is about."""
        return self._rpc(
            "assistant_mark_reply",
            {"p_run_id": str(self._run), "p_message_id": str(message_id), "p_kind": kind, "p_task_id": str(task_id) if task_id else None},
        )

    def list_conversations(self, *, tenant_id: uuid.UUID, limit: int, before: str | None) -> dict[str, Any]:
        """Job EA: the caller's own conversations, newest first (the database proves who is asking)."""
        return self._rpc("assistant_conversations_list", {"p_tenant_id": str(tenant_id), "p_limit": limit, "p_before": before})

    def archive_conversation(self, *, tenant_id: uuid.UUID, conversation_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc("assistant_conversation_archive", {"p_tenant_id": str(tenant_id), "p_conversation_id": str(conversation_id)})

    def save_reply_draft(
        self,
        *,
        draft_id: uuid.UUID,
        lead_id: uuid.UUID | None,
        enquiry_id: uuid.UUID | None,
        language: str,
        body: str,
        gloss_en: str,
    ) -> dict[str, Any]:
        return self._rpc(
            "assistant_save_reply_draft",
            {
                "p_run_id": str(self._run),
                "p_draft_id": str(draft_id),
                "p_lead_id": str(lead_id) if lead_id else None,
                "p_enquiry_id": str(enquiry_id) if enquiry_id else None,
                "p_language": language,
                "p_body": body,
                "p_gloss_en": gloss_en,
            },
        )

    # ---- reads (the caller's own rows, by row-level security)
    def rest_rows(self, what: str, path: str, params: dict[str, str]) -> list[dict[str, Any]]:
        rows = self._call(what, "GET", path, params=params)
        if not isinstance(rows, list) or any(not isinstance(r, dict) for r in rows):
            raise DataLayerUnavailable
        return rows

    def conversation(self, conversation_id: uuid.UUID) -> dict[str, Any] | None:
        rows = self.rest_rows(
            "read_conversation",
            "/assistant_conversations",
            {
                "select": f"{CONVERSATION_COLUMNS},assistant_messages({MESSAGE_COLUMNS})",
                "id": f"eq.{conversation_id}",
                "assistant_messages.order": "seq.asc",
                "limit": "1",
            },
        )
        return rows[0] if rows else None

    def history(
        self, conversation_id: uuid.UUID, before_seq: int, limit: int
    ) -> list[dict[str, Any]]:
        """The messages of a chat before this one (the last `limit`, oldest first): role, text, language only."""
        rows = self.rest_rows(
            "read_history",
            "/assistant_messages",
            {
                "select": "seq,role,body,language",
                "conversation_id": f"eq.{conversation_id}",
                "seq": f"lt.{before_seq}",
                "order": "seq.desc",
                "limit": str(limit),
            },
        )
        return list(reversed(rows))

    def user_message_text(self, message_id: uuid.UUID, tenant_id: uuid.UUID) -> str | None:
        """The words of one of the caller's OWN messages (a person reads only the chats they started), or None. Used by the voice route to reuse the transcript of a message it already heard (job BD)."""
        rows = self.rest_rows(
            "read_user_message",
            "/assistant_messages",
            {
                "select": "body",
                "id": f"eq.{message_id}",
                "tenant_id": f"eq.{tenant_id}",
                "role": "eq.user",
                "limit": "1",
            },
        )
        body = rows[0].get("body") if rows else None
        return body if isinstance(body, str) and body else None
