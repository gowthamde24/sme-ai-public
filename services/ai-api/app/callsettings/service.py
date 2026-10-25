"""What the routes call (job DP part 4): the saved settings or the defaults of the business type, a campaign's override, and the EFFECTIVE settings a dialer applies (the workspace's with the campaign's override on
top, and the calling hours resolved: the campaign's, else this setting's, else the AI assistant's)."""

from __future__ import annotations

import uuid
from typing import Any

from app.assistant_settings import data as assistant_data
from app.callsettings import data
from app.callsettings.models import (
    CallHours,
    CallSettings,
    CallSettingsOut,
    CallSettingsOverride,
    CampaignCallSettingsOut,
    EffectiveCallSettings,
    EffectiveHours,
    OptionOut,
    OptionsOut,
)
from app.callsettings.repository import CallSettingsRepository
from app.errors import ApiError

# the fields a campaign can change (everything but holidays, handover and the purposes)
OVERRIDABLE = tuple(CallSettingsOverride.model_fields)


def assistant_hours(row: dict[str, Any], business_type: str) -> CallHours:
    """The AI assistant's days and hours: what the owner saved, or the business type's defaults (the same the assistant settings show)."""
    given = row.get("assistant_hours")
    if isinstance(given, dict):
        return CallHours.model_validate(given)
    d = assistant_data.defaults_for(business_type)
    return CallHours(days=d["call_days"], from_minute=d["call_from_minute"], to_minute=d["call_to_minute"])


def resolve(base: CallSettings, override: CallSettingsOverride | None, assistant: CallHours) -> EffectiveCallSettings:
    """The workspace's settings with the override on top. Pure."""
    merged = base.model_dump(mode="json")
    changed: list[str] = []
    hours_source = "assistant"
    if base.hours is not None:
        hours_source = "workspace"
    if override is not None:
        for field in OVERRIDABLE:
            value = getattr(override, field)
            if field == "auto_pause_off":
                if value:
                    merged["auto_pause_refusals_per_hour"] = None
                    changed.append("auto_pause_refusals_per_hour")
                continue
            if value is None:
                continue
            merged[field] = value.model_dump(mode="json") if hasattr(value, "model_dump") else [v.model_dump(mode="json") if hasattr(v, "model_dump") else v for v in value] if isinstance(value, list) else value
            changed.append(field)
            if field == "hours":
                hours_source = "campaign"
    settings = CallSettings.model_validate(merged)
    use = settings.hours or assistant
    return EffectiveCallSettings(
        settings=settings,
        hours=EffectiveHours(days=sorted(use.days), from_minute=use.from_minute, to_minute=use.to_minute, source=hours_source),  # type: ignore[arg-type]
        overridden=sorted(set(changed)),
    )


class CallSettingsService:
    def __init__(self, repository: CallSettingsRepository) -> None:
        self._repo = repository

    # ------------------------------------------------------------------ the workspace
    def get(self, token: str, tenant_id: uuid.UUID) -> CallSettingsOut:
        row = self._repo.get(token, tenant_id)
        biz = data.business_type(str(row.get("business_type")))
        defaults = CallSettings.model_validate(data.defaults_for(biz))
        saved = bool(row.get("saved"))
        settings = CallSettings.model_validate(row["settings"]) if saved and row.get("settings") else defaults
        hours = assistant_hours(row, biz)
        return CallSettingsOut(
            settings=settings,
            saved=saved,
            defaults=defaults,
            business_type=biz,
            effective=resolve(settings, None, hours),
            options=self._options(),
            assistant_hours=hours,
            locked=dict(row.get("locked") or {}),
            updated_at=row.get("updated_at"),
            wording="draft",
        )

    def save(self, token: str, tenant_id: uuid.UUID, settings: CallSettings) -> CallSettingsOut:
        locked = self._repo.get(token, tenant_id).get("locked") or {}
        held = settings.model_dump(mode="json")
        for field, allowed in locked.items():
            if not set(held.get(field) or []) <= set(allowed):
                # the school rule (owner, 25 Oct 2026): the database refuses it too; this answers in plain words
                raise ApiError(422, "locked_for_business_type", "This business type does not allow that: a school's assistant makes no sales calls and none about dues or fees.")
        self._repo.save(token, tenant_id, held)
        return self.get(token, tenant_id)

    # ------------------------------------------------------------------ one campaign
    def campaign_get(self, token: str, tenant_id: uuid.UUID, campaign_id: uuid.UUID) -> CampaignCallSettingsOut:
        row = self._repo.campaign_get(token, tenant_id, campaign_id)
        return self._campaign_out(token, tenant_id, campaign_id, row)

    def campaign_save(self, token: str, tenant_id: uuid.UUID, campaign_id: uuid.UUID, overrides: CallSettingsOverride) -> CampaignCallSettingsOut:
        row = self._repo.campaign_save(token, tenant_id, campaign_id, overrides.model_dump(mode="json", exclude_none=True))
        return self._campaign_out(token, tenant_id, campaign_id, row)

    def campaign_clear(self, token: str, tenant_id: uuid.UUID, campaign_id: uuid.UUID) -> CampaignCallSettingsOut:
        row = self._repo.campaign_clear(token, tenant_id, campaign_id)
        return self._campaign_out(token, tenant_id, campaign_id, row)

    def _campaign_out(self, token: str, tenant_id: uuid.UUID, campaign_id: uuid.UUID, row: dict[str, Any]) -> CampaignCallSettingsOut:
        workspace = self.get(token, tenant_id)
        saved = bool(row.get("saved"))
        overrides = CallSettingsOverride.model_validate(row["overrides"]) if saved and row.get("overrides") else CallSettingsOverride()
        return CampaignCallSettingsOut(
            campaign_id=campaign_id,
            overrides=overrides,
            saved=saved,
            effective=resolve(workspace.settings, overrides, workspace.assistant_hours),
            updated_at=row.get("updated_at"),
        )

    @staticmethod
    def _options() -> OptionsOut:
        o = data.load()["options"]

        def make(items: list[dict[str, Any]]) -> list[OptionOut]:
            return [OptionOut(id=i["id"], label=i["label"], description=i.get("description")) for i in items]

        return OptionsOut(
            voicemail_actions=make(o["voicemail_actions"]),
            phone_menu_actions=make(o["phone_menu_actions"]),
            sensitivities=make(o["sensitivities"]),
            topics=make(o["topics"]),
            purposes=make(o["purposes"]),
        )
