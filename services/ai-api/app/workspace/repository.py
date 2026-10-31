"""The shop's basics and the weekly report (job BY, ADR 0077): SECURITY DEFINER functions of migration 20261118090100, called with the caller's own token."""

from __future__ import annotations

import uuid
from datetime import date
from typing import Any, Protocol

from app.rpc_base import RpcClient
from app.workspace.errors import TypeChangeRefusedError


class WorkspaceRepository(Protocol):
    def profile(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def save_profile(self, token: str, tenant_id: uuid.UUID, name: str | None, town: str | None, languages: list[str] | None) -> dict[str, Any]: ...
    def weekly_report(self, token: str, tenant_id: uuid.UUID, week_start: date | None) -> dict[str, Any]: ...
    # job DT (ADR 0115): the business profile, the members' own profiles, the images bucket and the sign-in status
    def business(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def save_business(self, token: str, tenant_id: uuid.UUID, patch: dict[str, Any]) -> dict[str, Any]: ...
    def ensure_images_bucket(self, token: str, tenant_id: uuid.UUID) -> str: ...
    def set_logo(self, token: str, tenant_id: uuid.UUID, path: str | None) -> dict[str, Any]: ...
    def my_profile(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def save_my_profile(self, token: str, tenant_id: uuid.UUID, patch: dict[str, Any]) -> dict[str, Any]: ...
    def people(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]: ...
    def account_security(self, token: str) -> dict[str, Any]: ...
    # job DT (ADR 0116): the opening line and the "mention AI" switch
    def opening(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def set_opening_line(self, token: str, tenant_id: uuid.UUID, language: str, campaign_id: str | None, text: str | None) -> dict[str, Any]: ...
    def set_mention_ai(self, token: str, tenant_id: uuid.UUID, campaign_id: str | None, mention_ai: bool | None) -> dict[str, Any]: ...
    def voice_choices(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def set_voice_choice(self, token: str, tenant_id: uuid.UUID, language: str, voice_id: str | None) -> dict[str, Any]: ...
    def set_voice_gender(self, token: str, tenant_id: uuid.UUID, gender: str) -> dict[str, Any]: ...
    # job pronunciation-quality: the workspace's own pronunciation words
    def pronunciation_list(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]: ...
    def pronunciation_set(self, token: str, tenant_id: uuid.UUID, word: str, sounds_like: str, language: str | None, message_id: uuid.UUID | None) -> dict[str, Any]: ...
    def pronunciation_delete(self, token: str, tenant_id: uuid.UUID, item_id: uuid.UUID) -> bool: ...
    # owner decision 31 Oct 2026: the live activity feed
    def activity(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]: ...


class PostgrestWorkspaceRepository:
    def __init__(self, rest_url: str, anon_key: str, *, rpc: RpcClient | None = None) -> None:
        self._rpc = rpc or RpcClient(rest_url, anon_key, {"SM791": TypeChangeRefusedError})

    def profile(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "workspace_profile_get", {"p_tenant_id": str(tenant_id)})

    def save_profile(self, token: str, tenant_id: uuid.UUID, name: str | None, town: str | None, languages: list[str] | None) -> dict[str, Any]:
        return self._rpc.object(token, "workspace_profile_save", {"p_tenant_id": str(tenant_id), "p_name": name, "p_town": town, "p_languages": languages})

    def weekly_report(self, token: str, tenant_id: uuid.UUID, week_start: date | None) -> dict[str, Any]:
        return self._rpc.object(token, "weekly_report", {"p_tenant_id": str(tenant_id), "p_week_start": week_start.isoformat() if week_start else None})

    def business(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "workspace_business_get", {"p_tenant_id": str(tenant_id)})

    def save_business(self, token: str, tenant_id: uuid.UUID, patch: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(token, "workspace_business_set", {"p_tenant_id": str(tenant_id), "p_patch": patch})

    def ensure_images_bucket(self, token: str, tenant_id: uuid.UUID) -> str:
        bucket = self._rpc.call(token, "workspace_images_ensure_bucket", {"p_tenant_id": str(tenant_id)})
        return str(bucket)

    def set_logo(self, token: str, tenant_id: uuid.UUID, path: str | None) -> dict[str, Any]:
        return self._rpc.object(token, "workspace_logo_set", {"p_tenant_id": str(tenant_id), "p_path": path})

    def my_profile(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "my_profile_get", {"p_tenant_id": str(tenant_id)})

    def save_my_profile(self, token: str, tenant_id: uuid.UUID, patch: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(token, "my_profile_set", {"p_tenant_id": str(tenant_id), "p_patch": patch})

    def people(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        result = self._rpc.call(token, "people_profiles", {"p_tenant_id": str(tenant_id)})
        return [r for r in result if isinstance(r, dict)] if isinstance(result, list) else []

    def account_security(self, token: str) -> dict[str, Any]:
        return self._rpc.object(token, "account_security_get", {})

    def opening(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "opening_get", {"p_tenant_id": str(tenant_id)})

    def set_opening_line(self, token: str, tenant_id: uuid.UUID, language: str, campaign_id: str | None, text: str | None) -> dict[str, Any]:
        return self._rpc.object(token, "opening_set_line", {"p_tenant_id": str(tenant_id), "p_language": language, "p_campaign_id": campaign_id, "p_text": text})

    def set_mention_ai(self, token: str, tenant_id: uuid.UUID, campaign_id: str | None, mention_ai: bool | None) -> dict[str, Any]:
        return self._rpc.object(token, "opening_set_mention", {"p_tenant_id": str(tenant_id), "p_campaign_id": campaign_id, "p_mention_ai": mention_ai})

    def voice_choices(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "call_voice_get", {"p_tenant_id": str(tenant_id)})

    def set_voice_choice(self, token: str, tenant_id: uuid.UUID, language: str, voice_id: str | None) -> dict[str, Any]:
        return self._rpc.object(token, "call_voice_set", {"p_tenant_id": str(tenant_id), "p_language": language, "p_voice_id": voice_id})

    def set_voice_gender(self, token: str, tenant_id: uuid.UUID, gender: str) -> dict[str, Any]:
        return self._rpc.object(token, "call_voice_gender_set", {"p_tenant_id": str(tenant_id), "p_gender": gender})

    def pronunciation_list(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        return self._rpc.array(token, "pronunciation_list", {"p_tenant_id": str(tenant_id)})

    def activity(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        return self._rpc.array(token, "assistant_activity", {"p_tenant_id": str(tenant_id)})

    def pronunciation_set(self, token: str, tenant_id: uuid.UUID, word: str, sounds_like: str, language: str | None, message_id: uuid.UUID | None) -> dict[str, Any]:
        return self._rpc.object(
            token, "pronunciation_set",
            {"p_tenant_id": str(tenant_id), "p_word": word, "p_sounds_like": sounds_like, "p_language": language, "p_message_id": str(message_id) if message_id else None},
        )

    def pronunciation_delete(self, token: str, tenant_id: uuid.UUID, item_id: uuid.UUID) -> bool:
        return bool(self._rpc.call(token, "pronunciation_delete", {"p_tenant_id": str(tenant_id), "p_id": str(item_id)}))
