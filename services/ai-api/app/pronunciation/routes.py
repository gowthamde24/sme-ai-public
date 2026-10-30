"""The workspace's pronunciation words (job pronunciation-quality; Settings > Pronunciation and the chat's "Mispronounced?"). Contract: ~/Desktop/stack19-jobs/contract-pronunciation.md.

  GET    /v1/tenants/{t}/ai-assistant/pronunciation               any member -> {items: [{id, word, sounds_like, language|null, source: owner|suggested}], suggestions: [{word, sounds_like|null, reason: business_name|city|product}], shared_count}
  PUT    /v1/tenants/{t}/ai-assistant/pronunciation               Owner, Admin  {word 1..60, sounds_like 1..80, language|null, message_id?}  upsert by word (any case) -> the item
  POST   /v1/tenants/{t}/ai-assistant/pronunciation               the same as PUT (the chat's "Mispronounced?" action), 200 with the item
  POST   /v1/tenants/{t}/ai-assistant/pronunciation/{id}/delete   Owner, Admin -> 204 (no DELETE verb)
  POST   /v1/tenants/{t}/ai-assistant/pronunciation/preview       Owner, Admin  {word, sounds_like, language} -> audio/wav: the word in a short sentence, in the workspace's voice for that language, with this respelling

`language` null means every language. `sounds_like` is plain text an engine can read (a respelling in Latin letters or in the script of the language). A word added here wins over the shared lexicon; a saved word is heard from the next
sentence of every talk and call. 429 `rate_limited` on the preview (six a minute, a daily character cap per workspace); 404 `no_sample` when the voice is off.

NOTE: no `from __future__ import annotations` here (body models are attached to the endpoint signatures at registration time)."""

# ruff: noqa: E501

import io
import uuid
import wave
from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, ConfigDict, StringConstraints

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.conversation.fallback import FallbackTts
from app.conversation.picker import voice_state
from app.errors import ApiError
from app.integrations.ratelimit import SlidingWindow
from app.pronunciation.lexicon import OwnerWord, shared
from app.pronunciation.speech import SpeechText
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}/ai-assistant/pronunciation", tags=["ai-assistant"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
AnyMember = Annotated[TenantContext, Depends(require_tenant_role())]
OwnerAdmin = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]
Language = Literal["en", "te", "hi", "kn", "ta", "ml"]
Word = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
Sound = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]

IST = timezone(timedelta(hours=5, minutes=30))
PREVIEW_PER_MINUTE = 6
PREVIEW_DAILY_CHARS = 1500
_CARRIER = {   # a short sentence around the word, so the voice has a context to say it in
    "en": "This is a call from {w}.", "te": "{w} నుంచి మాట్లాడుతున్నాను.", "hi": "यह {w} से कॉल है।", "kn": "{w} ಇಂದ ಮಾತಾಡ್ತಾ ಇದ್ದೀನಿ.", "ta": "{w} இலிருந்து பேசுகிறேன்.", "ml": "{w} ൽ നിന്ന് വിളിക്കുന്നു.",
}
_COMMON = frozenset("and the store stores shop shops traders trading enterprises silks sarees saree textiles school schools college academy constructions construction materials hardware pvt ltd limited company co".split())
_minute = SlidingWindow(PREVIEW_PER_MINUTE, 60.0)
_spent: dict[tuple[uuid.UUID, str], int] = {}


class WordIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    word: Word
    sounds_like: Sound
    language: Language | None = None
    message_id: uuid.UUID | None = None


class PreviewIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    word: Word
    sounds_like: Sound
    language: Language


def _repo(runtime: Runtime):  # type: ignore[no-untyped-def]
    if runtime.workspace is None:
        raise ApiError(503, "unavailable", "This is not available right now.")
    return runtime.workspace


def suggestions(business: str, town: str | None, known: set[str]) -> list[dict[str, object]]:
    """Words of the workspace that a voice may get wrong and that are not saved yet: its business name, the words of it, and its town. `sounds_like` is the lexicon's respelling when it knows the word, else null."""
    out: list[dict[str, object]] = []
    seen = set(known)

    def add(word: str, reason: str) -> None:
        key = word.strip().casefold()
        if not key or key in seen or len(word) > 60:
            return
        seen.add(key)
        respelling = SpeechText().prepare(word.strip(), "en")   # what an English voice is given for it, when the shared words know it
        out.append({"word": word.strip(), "sounds_like": respelling if respelling.casefold() != word.strip().casefold() else None, "reason": reason})

    add(business, "business_name")
    for token in business.replace("-", " ").split():
        if len(token) >= 4 and token.casefold() not in _COMMON and token.isalpha():
            add(token, "business_name")
    if town:
        add(town, "city")
    return out


@router.get("")
def get_words(ctx: AnyMember, runtime: RuntimeDep) -> dict[str, object]:
    repo = _repo(runtime)
    token, tenant = ctx.principal.token, ctx.tenant.id
    items = repo.pronunciation_list(token, tenant)
    town: str | None = None
    try:
        town = repo.profile(token, tenant).get("town")
    except Exception:   # noqa: BLE001  suggestions never stop the list
        town = None
    known = {str(i.get("word", "")).casefold() for i in items}
    return {"items": items, "suggestions": suggestions(ctx.tenant.name, town, known), "shared_count": len(shared().entries)}


def _save(body: WordIn, ctx: TenantContext, runtime: Runtime) -> dict[str, object]:
    saved: dict[str, object] = _repo(runtime).pronunciation_set(ctx.principal.token, ctx.tenant.id, body.word, body.sounds_like, body.language, body.message_id)
    return saved


@router.put("")
def put_word(body: WordIn, ctx: OwnerAdmin, runtime: RuntimeDep) -> dict[str, object]:
    return _save(body, ctx, runtime)


@router.post("")
def post_word(body: WordIn, ctx: OwnerAdmin, runtime: RuntimeDep) -> dict[str, object]:
    return _save(body, ctx, runtime)


@router.post("/preview")
async def preview(body: PreviewIn, ctx: OwnerAdmin, runtime: RuntimeDep) -> Response:
    bv = runtime.browser_voice
    if bv is None:
        raise ApiError(404, "no_sample", "There is no preview for this voice.")
    text = _CARRIER[body.language].format(w=body.word)
    day = (ctx.tenant.id, datetime.now(IST).date().isoformat())   # a daily counter per workspace (in memory, reset on a restart: a cap on a paid voice, not an audit)
    if not _minute.allow(str(ctx.tenant.id)):
        raise ApiError(429, "rate_limited", "Too many previews. Please try again a little later.", retry_after=int(_minute.retry_after(str(ctx.tenant.id))) or 1)
    if _spent.get(day, 0) + len(text) > PREVIEW_DAILY_CHARS:
        raise ApiError(429, "rate_limited", "Too many previews today. Please try again tomorrow.", retry_after=3600)
    _spent[day] = _spent.get(day, 0) + len(text)
    chosen, gender = voice_state(runtime, ctx)
    tts = FallbackTts(bv.config, bv.factory, chosen=chosen, gender=gender)
    tts.set_owner_words([OwnerWord(body.word, body.sounds_like, body.language)])
    tts.begin_turn()
    pcm = b"".join([chunk async for chunk in tts.stream(text, body.language)])
    if not pcm:
        raise ApiError(404, "no_sample", "There is no preview for this voice.")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(tts.sample_rate)
        w.writeframes(pcm)
    return Response(content=buf.getvalue(), media_type="audio/wav", headers={"Cache-Control": "no-store"})


@router.post("/{item_id}/delete", status_code=204)
def delete_word(item_id: uuid.UUID, ctx: OwnerAdmin, runtime: RuntimeDep) -> Response:
    _repo(runtime).pronunciation_delete(ctx.principal.token, ctx.tenant.id, item_id)
    return Response(status_code=204)
