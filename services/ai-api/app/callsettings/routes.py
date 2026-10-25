"""Call settings under /v1/tenants/{tenant_id}/call-settings (job DP part 4). The contract is packages/contracts/call_settings.* and docs/contracts/call-settings.md.

  GET    /call-settings                          the settings in force (or the business type's defaults before the first save), the defaults, the options, the AI assistant's hours. Owner, Admin.
  PUT    /call-settings                          save all of them. Owner with a second factor. 422 `locked_for_business_type` for a school asking for sales or dues calls.
  GET    /call-settings/campaigns/{campaign_id}  that campaign's override and the EFFECTIVE settings a dialer applies to it. Owner, Admin.
  PUT    /call-settings/campaigns/{campaign_id}  save the override (a partial document: null or absent = inherit; an empty one removes it). Owner with a second factor.
  DELETE /call-settings/campaigns/{campaign_id}  remove the override. Owner with a second factor.

Telephony does not exist yet: nothing here places a call.

NOTE: no `from __future__ import annotations` here (request models are attached to the endpoint signatures at registration time)."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.callsettings.models import (
    CallSettings,
    CallSettingsOut,
    CallSettingsOverride,
    CampaignCallSettingsOut,
)
from app.callsettings.service import CallSettingsService
from app.crm.models import parse_uuid
from app.errors import ApiError, not_found
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}/call-settings", tags=["call-settings"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
OwnerAdmin = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]
OwnerStrong = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, strong=True))]


def _service(runtime: Runtime) -> CallSettingsService:
    if runtime.call_settings is None:
        raise ApiError(503, "call_settings_unavailable", "Call settings are not available right now.")
    return runtime.call_settings


def _campaign(raw: str) -> uuid.UUID:
    parsed = parse_uuid(raw)
    if parsed is None:
        raise not_found()
    return parsed


@router.get("", response_model=CallSettingsOut)
def get_settings(ctx: OwnerAdmin, runtime: RuntimeDep) -> CallSettingsOut:
    return _service(runtime).get(ctx.principal.token, ctx.tenant.id)


@router.put("", response_model=CallSettingsOut)
def put_settings(body: CallSettings, ctx: OwnerStrong, runtime: RuntimeDep) -> CallSettingsOut:
    return _service(runtime).save(ctx.principal.token, ctx.tenant.id, body)


@router.get("/campaigns/{campaign_id}", response_model=CampaignCallSettingsOut)
def get_campaign(campaign_id: str, ctx: OwnerAdmin, runtime: RuntimeDep) -> CampaignCallSettingsOut:
    return _service(runtime).campaign_get(ctx.principal.token, ctx.tenant.id, _campaign(campaign_id))


@router.put("/campaigns/{campaign_id}", response_model=CampaignCallSettingsOut)
def put_campaign(campaign_id: str, body: CallSettingsOverride, ctx: OwnerStrong, runtime: RuntimeDep) -> CampaignCallSettingsOut:
    return _service(runtime).campaign_save(ctx.principal.token, ctx.tenant.id, _campaign(campaign_id), body)


@router.delete("/campaigns/{campaign_id}", response_model=CampaignCallSettingsOut)
def delete_campaign(campaign_id: str, ctx: OwnerStrong, runtime: RuntimeDep) -> CampaignCallSettingsOut:
    return _service(runtime).campaign_clear(ctx.principal.token, ctx.tenant.id, _campaign(campaign_id))
