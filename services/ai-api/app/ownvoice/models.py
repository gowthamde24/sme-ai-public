"""The own-voice API shapes (job DP part 5). Committed EARLY as a contract (packages/contracts/own_voice.*): Settings > AI assistant > "Use my own voice" is built against it.

Only the workspace Owner (second factor) can make or delete a voice. The person records a 15 to 60 second sample and reads one fixed consent sentence aloud ("I, <name>, allow Stack19 to create an AI voice of me
for <business>"); both recordings are kept in the workspace's private storage while the voice exists; the cloned voice then appears in Settings > AI assistant as the persona `own_voice`. The assistant still
says it is the AI assistant. "Delete my voice" removes the voice at the provider, the sample and the consent recording, and the person's name from our records. Only a FAKE provider exists today.

NOTE: no `from __future__ import annotations` (the models are attached to endpoint signatures at registration time)."""

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

AudioType = Literal["audio/webm", "audio/ogg", "audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp4", "audio/x-m4a", "video/webm", "video/mp4"]
Status = Literal["none", "pending", "ready", "failed", "deleted"]
Language = Literal["en", "te", "hi", "kn"]
# a name carries no markup, braces, at-signs or slashes (it is spoken and kept as consent evidence, never interpreted)
PersonName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=80, pattern=r"^[^<>{}@/\\|\x00-\x1f\x7f]+$")]

MAX_SAMPLE_BYTES = 10 * 1024 * 1024
MAX_CONSENT_BYTES = 3 * 1024 * 1024


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SentenceOut(_Strict):
    """The exact words to read aloud, with this person's name and this business's name filled in."""

    sentence: str


class OwnVoiceOut(_Strict):
    # `none` = no voice yet (or only a deleted one). `pending` is a moment while the provider works; `failed` = the provider refused (nothing is kept).
    status: Status
    id: uuid.UUID | None = None
    consenting_name: str | None = None
    consented_at: datetime | None = None
    sample_seconds: float | None = None
    consent_seconds: float | None = None
    ready_at: datetime | None = None
    deleted_at: datetime | None = None
    # the languages the voice can speak (the persona `own_voice` is selectable in Settings > AI assistant for these)
    languages: list[Language]
    # the fixed introduction still says "AI assistant": a voice of the owner does not change who is speaking
    says_ai_assistant: Literal[True] = True
    fake: Literal[True] = True


class OwnVoiceIn(_Strict):
    """Everything in one request: the two recordings are base64 (no multipart). `id` is a uuid the client makes (a retry with it is the same request)."""

    id: uuid.UUID
    name: PersonName
    # the sentence exactly as GET /voice-clone/sentence gave it; the database checks it word for word
    consent_sentence: Annotated[str, StringConstraints(min_length=20, max_length=300)]
    sample_base64: Annotated[str, Field(min_length=100, max_length=14_500_000)]
    sample_type: AudioType
    # the length the browser measured; the server checks it against the file where it can (WAV) and against its size otherwise
    sample_seconds: Annotated[float, Field(ge=15, le=60)]
    consent_base64: Annotated[str, Field(min_length=100, max_length=4_300_000)]
    consent_type: AudioType
    consent_seconds: Annotated[float, Field(ge=2, le=30)]
