"""The phone assistant's model, with the rules of a call in code (job phone-calls part 3). Wraps a streaming model and decides, BEFORE the model is asked, the replies a call must get right every time:

  * "are you a robot?" -> the honest answer from `opening.honesty`, never the model's;
  * "do not call me again" -> the fixed acknowledgement, and the call ends after it;
  * a voicemail or phone-menu greeting in the first lines -> nothing is said to it (or, if the workspace asked for a message, one short fixed message), and the call ends;
and, after the model, it cuts any reply that starts to claim it is human and puts the honest answer in its place.
`on_event("stop" | "voicemail")` tells the call session, which closes the line after the audio of this turn has played."""

# ruff: noqa: E501
from __future__ import annotations

from collections.abc import AsyncIterator, Callable

from app.conversation.parts import StreamingLlm
from app.opening.honesty import claims_to_be_human, honest_answer, is_identity_question
from app.telephony import persona, triggers

VOICEMAIL_LOOKS = 2   # only the first lines of a call can be a mailbox greeting


class PhoneLlm:
    def __init__(self, inner: StreamingLlm, business: str, language: Callable[[], str], *, on_event: Callable[[str], None] | None = None, voicemail_action: str = "hang_up") -> None:
        self._inner, self._business, self._language = inner, business, language
        self._on_event, self._voicemail_action = on_event, voicemail_action
        self.honest_answers = 0

    def _event(self, name: str) -> None:
        if self._on_event is not None:
            self._on_event(name)

    async def stream(self, system: str, messages: list[dict[str, str]], model: str) -> AsyncIterator[str]:
        last = next((m["content"] for m in reversed(messages) if m.get("role") == "user"), "")
        language = self._language()
        user_turns = sum(1 for m in messages if m.get("role") == "user")
        if triggers.stop_requested(last):
            self._event("stop")
            yield persona.STOP_ACK.get(language, persona.STOP_ACK["en"])
            return
        if user_turns <= VOICEMAIL_LOOKS and triggers.voicemail_greeting(last):
            self._event("voicemail")
            if self._voicemail_action == "leave_message":
                yield persona.VOICEMAIL_MESSAGE.get(language, persona.VOICEMAIL_MESSAGE["en"]).replace("{business}", self._business)
            return
        if is_identity_question(last):
            self.honest_answers += 1
            yield honest_answer(language, self._business)
            return
        said = ""
        async for piece in self._inner.stream(system, messages, model):
            if claims_to_be_human(said + piece):
                self.honest_answers += 1
                yield honest_answer(language, self._business)
                return
            said += piece
            yield piece
