"""Voice notes behind an interface (Supabase PostgREST today; job CV, ADR 0088). Every call carries the CALLER's token; the functions are SECURITY DEFINER functions of migration 20261126090000 that prove the
role (and, for what changes the business's voice, the second factor) and the module first. The worker's two calls (`scheduler_voice_plan`, `scheduler_voice_record`) are in app/scheduler/repository.py."""

from __future__ import annotations

import uuid
from typing import Any, Protocol

import httpx

from app.campaigns.errors import CampaignStateError
from app.packs.errors import ModuleOffError
from app.rpc_base import RpcClient


class VoiceNotesRepository(Protocol):
    def settings(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def set_settings(self, token: str, tenant_id: uuid.UUID, enabled: bool, speed: float, call_from_hour: int, call_to_hour: int) -> dict[str, Any]: ...
    def voices(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]: ...
    def set_choice(self, token: str, tenant_id: uuid.UUID, language: str, voice_code: str | None) -> dict[str, Any]: ...
    def disclosure(self, token: str, tenant_id: uuid.UUID, language: str) -> dict[str, Any]: ...
    def usage(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def campaign(self, token: str, tenant_id: uuid.UUID, campaign_id: uuid.UUID) -> dict[str, Any]: ...
    def set_campaign(self, token: str, tenant_id: uuid.UUID, campaign_id: uuid.UUID, enabled: bool) -> dict[str, Any]: ...
    def preview_plan(self, token: str, tenant_id: uuid.UUID, language: str) -> dict[str, Any]: ...
    def preview_record(self, token: str, tenant_id: uuid.UUID, preview_id: uuid.UUID, language: str, seconds: int, chars: int) -> dict[str, Any]: ...


class PostgrestVoiceNotesRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._rpc = RpcClient(rest_url, anon_key, {"SM701": ModuleOffError, "SM801": CampaignStateError}, client=client)

    def close(self) -> None:
        self._rpc.close()

    def settings(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "voice_settings_get", {"p_tenant_id": str(tenant_id)})

    def set_settings(self, token: str, tenant_id: uuid.UUID, enabled: bool, speed: float, call_from_hour: int, call_to_hour: int) -> dict[str, Any]:
        return self._rpc.object(
            token,
            "voice_settings_set",
            {"p_tenant_id": str(tenant_id), "p_enabled": enabled, "p_speed": speed, "p_call_from_hour": call_from_hour, "p_call_to_hour": call_to_hour},
        )

    def voices(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        return self._rpc.array(token, "voice_voices_list", {"p_tenant_id": str(tenant_id)})

    def set_choice(self, token: str, tenant_id: uuid.UUID, language: str, voice_code: str | None) -> dict[str, Any]:
        return self._rpc.object(token, "voice_choice_set", {"p_tenant_id": str(tenant_id), "p_language": language, "p_voice_code": voice_code})

    def disclosure(self, token: str, tenant_id: uuid.UUID, language: str) -> dict[str, Any]:
        return self._rpc.object(token, "voice_disclosure_get", {"p_tenant_id": str(tenant_id), "p_language": language})

    def usage(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "voice_usage_get", {"p_tenant_id": str(tenant_id)})

    def campaign(self, token: str, tenant_id: uuid.UUID, campaign_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "campaign_voice_get", {"p_tenant_id": str(tenant_id), "p_campaign_id": str(campaign_id)})

    def set_campaign(self, token: str, tenant_id: uuid.UUID, campaign_id: uuid.UUID, enabled: bool) -> dict[str, Any]:
        return self._rpc.object(token, "campaign_voice_set", {"p_tenant_id": str(tenant_id), "p_campaign_id": str(campaign_id), "p_enabled": enabled})

    def preview_plan(self, token: str, tenant_id: uuid.UUID, language: str) -> dict[str, Any]:
        return self._rpc.object(token, "voice_preview_plan", {"p_tenant_id": str(tenant_id), "p_language": language})

    def preview_record(self, token: str, tenant_id: uuid.UUID, preview_id: uuid.UUID, language: str, seconds: int, chars: int) -> dict[str, Any]:
        return self._rpc.object(
            token,
            "voice_preview_record",
            {"p_tenant_id": str(tenant_id), "p_preview_id": str(preview_id), "p_language": language, "p_seconds": seconds, "p_chars": chars},
        )
