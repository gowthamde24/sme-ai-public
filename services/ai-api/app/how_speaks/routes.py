"""GET/PUT /v1/tenants/{tenant_id}/how-assistant-speaks (owner decision 11 Nov 2026; contract docs/contracts/how-assistant-speaks.md).

One object for the panel, composed of what is stored in two places: the Talk training document (`tone`, `introduce_as`; jsonb, no migration) and the speaking style (style and region per language). Nothing new is stored.
  GET  Owner, Admin   (the Talk training document is readable by them only)
  PUT  Owner with a second factor; any subset; every part is checked BEFORE anything is written. Both stores audit their own saves (who, when).
`formal` is hidden from the options; a workspace that saved it earlier is shown as everyday_pure (saved: true) until it saves again.

NOTE: no `from __future__ import annotations` here (FastAPI reads the endpoint signatures at registration)."""

# ruff: noqa: E501

import logging
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Response

from app.agents import register
from app.auth.deps import OwnerOrAdmin, Runtime, TenantContext, get_runtime, require_tenant_role
from app.errors import ApiError
from app.how_speaks.models import (
    HowAssistantSpeaksIn,
    HowAssistantSpeaksOut,
    IntroduceOut,
    IntroducePreviewOut,
    PackDefaultsOut,
    ToneOut,
    WordsLanguageOut,
    WordsOptionsOut,
    WordsOut,
)
from app.speaking.models import LanguageStyle, SpeakingStyleIn
from app.talk_training import introduce
from app.talk_training.models import TalkTraining
from app.talk_training.routes import _defaults, _repo
from app.telephony import tone as tone_mod
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}/how-assistant-speaks", tags=["how-assistant-speaks"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
OwnerStrong = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, strong=True))]
LANGUAGES = ("te", "en", "hi", "kn", "ta", "ml")
logger = logging.getLogger("app.how_speaks")


def _pack_default_tone(runtime: Runtime, ctx: TenantContext) -> str:
    try:
        if runtime.packs is not None and runtime.pack_registry is not None:
            return str(runtime.pack_registry.call_tone(str(runtime.packs.workspace_pack(ctx.principal.token, ctx.tenant.id).get("pack_id") or "") or None))
    except Exception as exc:  # noqa: BLE001 - only the class is logged; the default is friendly
        logger.warning("pack tone lookup failed %s", exc.__class__.__name__)
    return tone_mod.DEFAULT_TONE


def _speaking(runtime: Runtime) -> Any:
    if runtime.speaking is None:
        raise ApiError(503, "speaking_style_unavailable", "This is not available right now.")
    return runtime.speaking


def _row_and_training(runtime: Runtime, ctx: TenantContext) -> tuple[dict[str, Any] | None, TalkTraining]:
    row = _repo(runtime).get(ctx.principal.token, ctx.tenant.id)
    saved = row is not None and isinstance(row.get("doc"), dict)
    training = TalkTraining.model_validate(row["doc"]) if saved and row is not None else _defaults(runtime, ctx)
    return (row if saved else None), training


def _owner_name(runtime: Runtime, ctx: TenantContext) -> str | None:
    """The Owner's own first name (from their profile). Only an Owner reading it: an Admin's profile is not the Owner's."""
    if ctx.role != Role.OWNER or runtime.workspace is None:
        return None
    try:
        return introduce.owner_name(runtime.workspace.my_profile(ctx.principal.token, ctx.tenant.id))
    except Exception:  # noqa: BLE001 - no profile, no name
        return None


def _preview(language: str, tone: str, business: str, pick: introduce.Introduce) -> str:
    return (tone_mod.opener(language, tone, pick) or "").replace("{business}", business)


def _out(runtime: Runtime, ctx: TenantContext) -> HowAssistantSpeaksOut:
    row, training = _row_and_training(runtime, ctx)
    pack_default = _pack_default_tone(runtime, ctx)
    doc = training.model_dump(mode="json") if row is not None else None
    value, source = tone_mod.effective_tone(doc, pack_default)
    style = _speaking(runtime).get(ctx.principal.token, ctx.tenant.id)
    languages: dict[Any, WordsLanguageOut] = {}
    for lang in LANGUAGES:
        one = style.languages[lang]
        languages[lang] = WordsLanguageOut(style="everyday_pure" if one.style == "formal" else one.style, region=one.region, saved=one.saved, examples=one.examples)
    options = WordsOptionsOut(styles=["everyday_mixed", "everyday_pure"], regions={lang: list(register.REGIONS[lang]) for lang in LANGUAGES})  # type: ignore[misc,arg-type]
    pick = introduce.Introduce(training.introduce_as.kind, training.introduce_as.text)
    business = ctx.tenant.name
    return HowAssistantSpeaksOut(
        tone=ToneOut(value=value, source=source, pack_default=pack_default, options=["respectful", "friendly"]),  # type: ignore[arg-type]
        words=WordsOut(languages=languages, options=options),
        introduce_as=IntroduceOut(
            kind=pick.kind, text=pick.text, options=["business", "owner", "custom"], owner_name=_owner_name(runtime, ctx),  # type: ignore[arg-type]
            preview=IntroducePreviewOut(te=_preview("te", value, business, pick), en=_preview("en", value, business, pick)),
        ),
        pack_defaults=PackDefaultsOut(tone=pack_default, words=register.DEFAULT_STYLE, region="neutral"),  # type: ignore[arg-type]
        legacy_address=(training.address if row is not None else None),
        updated_at=row.get("updated_at") if row is not None else None,
    )


@router.get("", response_model=HowAssistantSpeaksOut)
def get_how_assistant_speaks(ctx: OwnerOrAdmin, runtime: RuntimeDep, response: Response) -> HowAssistantSpeaksOut:
    response.headers["Cache-Control"] = "no-store"
    return _out(runtime, ctx)


@router.put("", response_model=HowAssistantSpeaksOut)
def put_how_assistant_speaks(ctx: OwnerStrong, runtime: RuntimeDep, body: HowAssistantSpeaksIn, response: Response) -> HowAssistantSpeaksOut:
    response.headers["Cache-Control"] = "no-store"
    sent = body.model_fields_set
    # 1. check every part before writing any
    pick: introduce.Introduce | None = None
    if "introduce_as" in sent and body.introduce_as is not None:
        try:
            pick = introduce.check(body.introduce_as.kind, body.introduce_as.text)
        except introduce.IntroduceError as err:
            raise ApiError(422, "validation_error", f"Invalid input: introduce_as ({err.reason})", extra={"fields": ["introduce_as"], "reason": err.reason}) from None
    words = body.words or {}
    for lang, choice in words.items():
        if choice is not None and choice.region not in register.REGIONS[lang]:
            raise ApiError(422, "validation_error", f"Invalid input: words.{lang}.region", extra={"fields": [f"words.{lang}.region"], "reason": "region_not_of_language"})
    # 2. the Talk training document (tone, introduce_as): the saved document, else the business type's defaults, with only these parts changed
    if "tone" in sent or "introduce_as" in sent:
        _, training = _row_and_training(runtime, ctx)
        doc = training.model_dump(mode="json")
        if "tone" in sent:
            doc["tone"] = body.tone   # None = back to "not chosen yet" (the business type decides)
        if "introduce_as" in sent:
            doc["introduce_as"] = {"kind": pick.kind, "text": pick.text} if pick is not None else {"kind": "business", "text": None}
        _repo(runtime).save(ctx.principal.token, ctx.tenant.id, TalkTraining.model_validate(doc).model_dump(mode="json"))
    # 3. the speaking style: the languages already saved stay as they are; the ones in the body change; a null puts that language back to the default
    if words:
        service = _speaking(runtime)
        current = service.get(ctx.principal.token, ctx.tenant.id)
        merged: dict[Any, LanguageStyle] = {lang: LanguageStyle(style=one.style, region=one.region) for lang, one in current.languages.items() if one.saved}
        for lang, choice in words.items():
            if choice is None:
                merged.pop(lang, None)
            else:
                merged[lang] = LanguageStyle(style=choice.style, region=choice.region)
        service.save(ctx.principal.token, ctx.tenant.id, SpeakingStyleIn(languages=merged))
    return _out(runtime, ctx)
