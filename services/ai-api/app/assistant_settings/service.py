"""What the routes call (job DM): the saved settings or the defaults of the business type, the options with the voices that exist, the preview line, and the FAKE test call."""

from __future__ import annotations

import uuid
from typing import Any

from app.assistant_settings import data
from app.assistant_settings.models import (
    AssistantOut,
    AssistantSettings,
    LanguageWord,
    OptionOut,
    OptionsOut,
    OutcomePreviewOut,
    PersonaOut,
    PreviewOut,
    TestCallOut,
    TranscriptLineOut,
    VoiceAvailabilityOut,
)
from app.assistant_settings.repository import AssistantSettingsRepository
from app.errors import ApiError

LANGUAGES: tuple[LanguageWord, ...] = ("en", "te", "hi", "kn")
NATIVE = {"en": "English", "te": "తెలుగు", "hi": "हिंदी", "kn": "ಕನ್ನಡ"}
# the customer's side of the SIMULATED test call (a draft for native review, like every line here)
CUSTOMER_LINES = {"en": "Yes, please send them.", "te": "అవును, పంపండి.", "hi": "हाँ, भेज दीजिए।", "kn": "ಹೌದು, ಕಳುಹಿಸಿ."}
CONFIRM_LINES = {
    "en": "Sent on WhatsApp. Thank you!",
    "te": "వాట్సాప్‌లో పంపాను. ధన్యవాదాలు!",
    "hi": "व्हाट्सऐप पर भेज दिया। धन्यवाद!",
    "kn": "ವಾಟ್ಸಾಪ್‌ನಲ್ಲಿ ಕಳುಹಿಸಿದ್ದೇನೆ. ಧನ್ಯವಾದ!",
}
TEST_CALL_NOTE = "This is a simulation. No call was made and nothing was sent or stored. A real test call to your own phone needs telephony, which is not built yet."


class AssistantSettingsService:
    def __init__(self, repository: AssistantSettingsRepository) -> None:
        self._repo = repository

    def get(self, token: str, tenant_id: uuid.UUID) -> AssistantOut:
        row = self._repo.get(token, tenant_id)
        biz = data.business_type(str(row.get("business_type")))
        defaults = AssistantSettings.model_validate(data.defaults_for(biz))
        saved = bool(row.get("saved"))
        settings = AssistantSettings.model_validate(row["settings"]) if saved and row.get("settings") else defaults
        business = str(row.get("business_name") or "")
        return AssistantOut(
            settings=settings,
            saved=saved,
            defaults=defaults,
            business_name=business,
            business_type=biz,
            intro={lang: data.intro(lang, settings.name, business) for lang in LANGUAGES},
            voice_notes_follow=bool(row.get("voice_notes")),
            locked=dict(row.get("locked") or {}),
            options=self._options(self._repo.voices(token, tenant_id)),
            updated_at=row.get("updated_at"),
            wording="draft",
        )

    def save(self, token: str, tenant_id: uuid.UUID, settings: AssistantSettings) -> AssistantOut:
        locked = self._repo.get(token, tenant_id).get("locked") or {}
        held = settings.model_dump()
        if any(held.get(field) != value for field, value in locked.items()):
            # the school rule (owner, 25 Oct 2026): the database refuses it too; this answers in plain words
            raise ApiError(422, "locked_for_business_type", "This business type does not allow that: the assistant does not talk about dues, fees or marks, gives no discount and has no order limit.")
        self._repo.save(token, tenant_id, held)
        return self.get(token, tenant_id)

    def preview(self, token: str, tenant_id: uuid.UUID, language: str, style: str, name: str | None) -> PreviewOut:
        current = self.get(token, tenant_id)
        shown = name if name else current.settings.name
        return PreviewOut(
            language=language,  # type: ignore[arg-type]
            style=style,  # type: ignore[arg-type]
            name=shown,
            text=data.sample(current.business_type, language, style, shown, current.business_name),
            intro=data.intro(language, shown, current.business_name),
            wording="draft",
        )

    def test_call(self, token: str, tenant_id: uuid.UUID) -> TestCallOut:
        current = self.get(token, tenant_id)
        s = current.settings
        language = s.main_language
        opening = data.sample(current.business_type, language, s.style, s.name, current.business_name)
        return TestCallOut(
            mode="fake",
            status="simulated",
            note=TEST_CALL_NOTE,
            transcript=[
                TranscriptLineOut(speaker="assistant", text=opening),
                TranscriptLineOut(speaker="customer", text=CUSTOMER_LINES[language]),
                TranscriptLineOut(speaker="assistant", text=CONFIRM_LINES[language]),
            ],
            outcome=OutcomePreviewOut(outcome="positive", category="interested", reason="Showed interest or asked for details."),
        )

    @staticmethod
    def _options(voices: list[dict[str, Any]]) -> OptionsOut:
        catalogue = data.load()
        have = {(str(v["persona"]), str(v["language"])): bool(v.get("synthetic")) for v in voices}
        personas = [
            PersonaOut(
                id=p["id"],
                label=p["label"]["en"],
                description=p["description"]["en"],
                languages={
                    lang: VoiceAvailabilityOut(available=(p["id"], lang) in have, synthetic=have.get((p["id"], lang), False))
                    for lang in LANGUAGES
                },
            )
            for p in catalogue["personas"]
        ]
        return OptionsOut(
            personas=personas,
            styles=[OptionOut(id=s["id"], label=s["label"]["en"], description=s["description"]["en"]) for s in catalogue["styles"]],
            languages=[OptionOut(id=lang, label=NATIVE[lang]) for lang in LANGUAGES],
        )
