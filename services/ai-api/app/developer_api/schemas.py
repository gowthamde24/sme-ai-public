"""The developer API's request and answer shapes, as pydantic models. They validate the new routes' bodies and they are what the OpenAPI document is generated from (scripts/developer_openapi.py):
the routes themselves answer plain dicts (the database's JSON), and `RESPONSES` says which model describes which answer. NOTE: no `from __future__ import annotations` (pydantic reads the annotations)."""

# ruff: noqa: E501

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.developer_api.routes import LeadIn

Text = Annotated[str, StringConstraints(strip_whitespace=True)]
Language = Literal["en", "te", "hi", "kn", "ta", "ml", "mr"]
Outcome = Literal["interested", "not_interested", "callback", "no_answer", "visit_booked"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ------------------------------------------------------------------ requests
class CallIn(_Strict):
    model_config = ConfigDict(extra="forbid", strict=True, json_schema_extra={"examples": [{"lead_id": "00000000-0000-4000-8000-000000000000", "dry_run": True}]})
    lead_id: Annotated[str, StringConstraints(pattern=r"^[0-9a-fA-F-]{36}$")]
    dry_run: bool = False


class JobIn(_Strict):
    name: Annotated[Text, StringConstraints(min_length=1, max_length=60)]
    goal: Annotated[str, StringConstraints(max_length=300)] | None = None


class CampaignIn(_Strict):
    model_config = ConfigDict(extra="forbid", json_schema_extra={"examples": [{
        "name": "Diwali enquiries", "language": "te", "job": {"name": "Follow up", "goal": "Ask if they still want the saree catalogue."},
        "contacts": [{"name": "Ravi Kumar", "phone": "+919800000001", "source": "website", "consent": {"given": True, "text": "I agree to be called"}}]}]})
    name: Annotated[Text, StringConstraints(min_length=1, max_length=120)]
    language: Language | None = None
    job: JobIn
    contacts: Annotated[list[dict[str, Any]], Field(min_length=1, max_length=500, description="At most 500 lead bodies (the same shape as POST /leads); each needs consent.")]


# ------------------------------------------------------------------ answers
class ErrorDetail(BaseModel):
    code: str
    message: str
    retry_after: int | None = None
    request_id: str | None = None


class ErrorOut(BaseModel):
    error: ErrorDetail


class LeadOut(BaseModel):
    id: str
    mode: Literal["test"]
    name: str
    phone: str | None
    email: str | None
    source: str | None
    language: Language | None
    notes: str | None
    custom_fields: dict[str, str]
    status: Literal["new", "contacted", "interested", "not_interested", "visit_booked", "won", "lost"]
    outcome: Outcome | None
    next_step: Literal["call", "call_at", "follow_up", "none"]
    next_step_at: str | None
    blocked: Literal["dnd", "calling_hours"] | None
    duplicate: bool
    created_at: str
    updated_at: str
    calls: list[str]


class LeadPage(BaseModel):
    items: list[LeadOut]
    next_after: str | None


class Cost(BaseModel):
    minutes: int
    paise: int


class CallOut(BaseModel):
    id: str
    mode: Literal["test"]
    lead_id: str
    status: Literal["queued", "in_progress", "completed", "failed"]
    outcome: Outcome | None
    scheduled_for: str
    started_at: str | None
    ended_at: str | None
    duration_seconds: int | None
    summary: str | None
    transcript: list[dict[str, str]] | None
    cost: Cost
    created_at: str


class CallPage(BaseModel):
    items: list[CallOut]
    next_after: str | None


class Gate(BaseModel):
    gate: Literal["sandbox", "number", "consent", "dnd", "wallet", "capacity", "calling_hours"]
    ok: bool
    code: str | None


class DryRunOut(BaseModel):
    dry_run: Literal[True]
    mode: Literal["test"]
    lead_id: str
    would_place: bool
    blocked_by: str | None
    starts: Literal["now", "at_opening"]
    starts_at: str
    gates: list[Gate]


class Refused(BaseModel):
    index: int
    code: str


class CampaignOut(BaseModel):
    id: str
    mode: Literal["test"]
    name: str
    language: Language | None
    job: JobIn
    status: Literal["draft"]
    contacts: int
    added: int
    duplicates: int
    created_at: str
    lead_ids: list[str] | None = None


class CampaignCreated(BaseModel):
    campaign: CampaignOut
    refused: list[Refused]


class CampaignPage(BaseModel):
    items: list[CampaignOut]
    next_after: str | None


class Counts(BaseModel):
    requests: int
    leads: int
    calls_simulated: int
    campaigns: int
    errors: int


class Limits(BaseModel):
    requests_per_minute: int
    calls_per_minute: int
    campaigns_per_minute: int
    concurrent_calls: int


class UsageOut(BaseModel):
    mode: Literal["test"]
    today: Counts
    month: Counts
    limits: Limits


class KeyOut(BaseModel):
    id: str
    name: str
    mode: Literal["test"]
    prefix: str
    last4: str
    scopes: list[str]
    ip_allow: list[str]
    created_at: str
    last_used_at: str | None
    rotated_at: str | None


class Workspace(BaseModel):
    id: str
    name: str


class MeOut(BaseModel):
    mode: Literal["test"]
    key: KeyOut
    workspace: Workspace


class ActivityItem(BaseModel):
    id: str
    key_id: str
    key_name: str | None
    method: str
    route: str
    status: int
    latency_ms: int
    at: str


class ActivityPage(BaseModel):
    items: list[ActivityItem]
    next_before: str | None


# (method, path) -> the request model; (method, path, status) -> the answer model (the document is generated from these and the routes)
REQUESTS: dict[tuple[str, str], type[BaseModel]] = {("POST", "/api/v1/leads"): LeadIn, ("POST", "/api/v1/calls"): CallIn, ("POST", "/api/v1/campaigns"): CampaignIn}
RESPONSES: dict[tuple[str, str, str], type[BaseModel] | tuple[type[BaseModel], ...]] = {
    ("GET", "/api/v1/me", "200"): MeOut,
    ("POST", "/api/v1/leads", "201"): LeadOut, ("POST", "/api/v1/leads", "200"): LeadOut, ("GET", "/api/v1/leads", "200"): LeadPage, ("GET", "/api/v1/leads/{lead_id}", "200"): LeadOut,
    ("POST", "/api/v1/calls", "201"): CallOut, ("POST", "/api/v1/calls", "200"): (DryRunOut, CallOut), ("GET", "/api/v1/calls", "200"): CallPage, ("GET", "/api/v1/calls/{call_id}", "200"): CallOut,
    ("POST", "/api/v1/campaigns", "201"): CampaignCreated, ("POST", "/api/v1/campaigns", "200"): CampaignCreated, ("GET", "/api/v1/campaigns", "200"): CampaignPage,
    ("GET", "/api/v1/campaigns/{campaign_id}", "200"): CampaignOut,
    ("GET", "/api/v1/usage", "200"): UsageOut, ("GET", "/api/v1/activity", "200"): ActivityPage,
}
