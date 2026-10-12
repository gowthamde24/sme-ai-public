"""Request bodies of the privacy-rights routes (job BN). Strict: an unknown field is a 422."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import Field, StringConstraints, model_validator

from app.crm.models import ApiUuid, _Strict

Days = Annotated[int, Field(strict=True)]


class ExportIn(_Strict):
    export_id: ApiUuid


class AccountDeletionIn(_Strict):
    request_id: ApiUuid
    confirm_email: Annotated[str, StringConstraints(min_length=3, max_length=320)]


class WorkspaceDeletionIn(_Strict):
    request_id: ApiUuid
    confirm_name: Annotated[str, StringConstraints(min_length=1, max_length=200)]


class RetentionIn(_Strict):
    """Days to keep each kind of record; null (or left out) = keep. The ranges are the database's (and are checked there again)."""

    chats_days: Annotated[int, Field(ge=30, le=3650, strict=True)] | None = None
    voice_days: Annotated[int, Field(ge=7, le=3650, strict=True)] | None = None
    enquiries_days: Annotated[int, Field(ge=90, le=3650, strict=True)] | None = None
    scheduler_days: Annotated[int, Field(ge=30, le=3650, strict=True)] | None = None
    audit_days: Annotated[int, Field(ge=365, le=3650, strict=True)] | None = None

    @model_validator(mode="after")
    def _voice_not_longer_than_chats(self) -> RetentionIn:
        if self.voice_days is not None and self.chats_days is not None and self.voice_days > self.chats_days:
            raise ValueError("voice transcripts cannot be kept longer than chats")
        return self

    def as_settings(self) -> dict[str, int | None]:
        return {
            "chats_days": self.chats_days,
            "voice_days": self.voice_days,
            "enquiries_days": self.enquiries_days,
            "scheduler_days": self.scheduler_days,
            "audit_days": self.audit_days,
        }


GrievanceKind = Literal["access", "correction", "erasure", "withdraw_consent", "complaint", "other"]
GrievanceStatus = Literal["acknowledged", "in_progress", "resolved", "rejected"]


class GrievanceIn(_Strict):
    grievance_id: ApiUuid
    kind: GrievanceKind
    subject: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
    details: Annotated[str, StringConstraints(max_length=4000)] = ""
    on_behalf: bool = False
    requester_name: Annotated[str, StringConstraints(strip_whitespace=True, max_length=120)] | None = None
    requester_contact: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] | None = None


class GrievanceUpdateIn(_Strict):
    status: GrievanceStatus
    note: Annotated[str, StringConstraints(strip_whitespace=True, max_length=1000)] | None = None
