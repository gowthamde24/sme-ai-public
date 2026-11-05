"""A routed request -> the plan card (job assistant-does-the-work design 2). The step is the screen's own route with the person's token; the card's words are made here by code from the state before
(read through the same routes) and the change. Undo is the route's own (a settings snapshot, pause <-> resume, an import's undo); the routes keep their role and second-factor rules."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
import base64
import csv
import io
import logging
import uuid
from typing import Any

from app.assistant.language import Language
from app.assistant_tools import executor
from app.assistant_work.router import Routed
from app.assistant_work.service import FileTurn, Tools, cant_do, card_of_plan
from app.assistant_work.store import WorkStore

logger = logging.getLogger("app.assistant_work.routed")

_NS = uuid.UUID("2f1d6a8e-61b5-4c1e-9b8f-9d2c4e7a1b30")
SCREENS = {
    "billing": {"label": "Plans", "href": "/plans"},
    "delete_workspace": {"label": "Settings -> Data", "href": "/settings/data"},
    "real_data_gate": {"label": "Settings -> Data", "href": "/settings/data"},
    "erase_person": {"label": "Privacy", "href": "/privacy"},
}
SCREEN_WHAT = {
    "billing": {"en": "changing your plan or payments", "te": "మీ ప్లాన్ లేదా చెల్లింపులు మార్చడం", "hi": "आपका प्लान या भुगतान बदलना", "kn": "ನಿಮ್ಮ ಪ್ಲಾನ್ ಅಥವಾ ಪಾವತಿಗಳನ್ನು ಬದಲಿಸುವುದು"},
    "delete_workspace": {"en": "deleting the workspace", "te": "వర్క్‌స్పేస్‌ను తొలగించడం", "hi": "वर्कस्पेस मिटाना", "kn": "ವರ್ಕ್‌ಸ್ಪೇಸ್ ಅಳಿಸುವುದು"},
    "real_data_gate": {"en": "switching real customer data on", "te": "నిజమైన కస్టమర్ డేటాను ఆన్ చేయడం", "hi": "असली ग्राहक डेटा चालू करना", "kn": "ನಿಜವಾದ ಗ್ರಾಹಕ ಡೇಟಾವನ್ನು ಆನ್ ಮಾಡುವುದು"},
    "erase_person": {"en": "erasing a person's data", "te": "ఒక వ్యక్తి డేటాను పూర్తిగా తొలగించడం", "hi": "किसी व्यक्ति का डेटा मिटाना", "kn": "ಒಬ್ಬ ವ್ಯಕ್ತಿಯ ಡೇಟಾ ಅಳಿಸುವುದು"},
}
WORDS: dict[str, dict[str, str]] = {
    "offer": {
        "en": "Here is the change: {summary}. Shall I make it? Check it on the card.",
        "te": "మార్పు ఇది: {summary}. చేయమంటారా? కార్డులో ఒకసారి చూడండి.",
        "hi": "बदलाव यह है: {summary}। कर दूँ? कार्ड पर एक बार देख लें।",
        "kn": "ಬದಲಾವಣೆ ಇದು: {summary}. ಮಾಡಲೇ? ಕಾರ್ಡ್‌ನಲ್ಲಿ ಒಮ್ಮೆ ನೋಡಿ.",
    },
    "same": {
        "en": "That is already so: {summary}. Nothing to change.",
        "te": "అది ఇప్పటికే అలానే ఉంది: {summary}. మార్చడానికి ఏమీ లేదు.",
        "hi": "यह पहले से ऐसा ही है: {summary}। बदलने को कुछ नहीं है।",
        "kn": "ಅದು ಈಗಾಗಲೇ ಹಾಗೆಯೇ ಇದೆ: {summary}. ಬದಲಿಸಲು ಏನೂ ಇಲ್ಲ.",
    },
    "screen_only": {
        "en": "Only a person can do that, on its screen: {what}. I've put the link on the card.",
        "te": "అది ఒక వ్యక్తి మాత్రమే, దాని స్క్రీన్‌లో చేయగలరు: {what}. లింక్ కార్డులో పెట్టాను.",
        "hi": "यह सिर्फ़ कोई व्यक्ति, उसकी स्क्रीन पर कर सकता है: {what}। लिंक कार्ड पर है।",
        "kn": "ಅದನ್ನು ಒಬ್ಬ ವ್ಯಕ್ತಿ ಮಾತ್ರ, ಅದರ ಸ್ಕ್ರೀನ್‌ನಲ್ಲಿ ಮಾಡಬಹುದು: {what}. ಲಿಂಕ್ ಕಾರ್ಡ್‌ನಲ್ಲಿ ಇಟ್ಟಿದ್ದೇನೆ.",
    },
    "clarify": {
        "en": "Tell me a little more, please: what exactly should I change?",
        "te": "దయచేసి ఇంకొంచెం చెప్పండి: సరిగ్గా ఏమి మార్చాలి?",
        "hi": "थोड़ा और बताइए: ठीक-ठीक क्या बदलना है?",
        "kn": "ದಯವಿಟ್ಟು ಇನ್ನೂ ಸ್ವಲ್ಪ ಹೇಳಿ: ನಿಖರವಾಗಿ ಏನು ಬದಲಿಸಬೇಕು?",
    },
    "no_source": {
        "en": "I couldn't find a lead source called '{source}'. Your sources: {names}.",
        "te": "'{source}' అనే లీడ్ సోర్స్ కనిపించలేదు. మీ సోర్స్‌లు: {names}.",
        "hi": "'{source}' नाम का लीड सोर्स नहीं मिला। आपके सोर्स: {names}।",
        "kn": "'{source}' ಎಂಬ ಲೀಡ್ ಸೋರ್ಸ್ ಸಿಗಲಿಲ್ಲ. ನಿಮ್ಮ ಸೋರ್ಸ್‌ಗಳು: {names}.",
    },
    "no_example": {
        "en": "There is no example data in this workspace.",
        "te": "ఈ వర్క్‌స్పేస్‌లో ఉదాహరణ డేటా ఏదీ లేదు.",
        "hi": "इस वर्कस्पेस में कोई उदाहरण डेटा नहीं है।",
        "kn": "ಈ ವರ್ಕ್‌ಸ್ಪೇಸ್‌ನಲ್ಲಿ ಉದಾಹರಣೆ ಡೇಟಾ ಇಲ್ಲ.",
    },
    "key_card": {
        "en": "Paste your IndiaMART CRM key on the card below. It goes straight to a locked store: it is never in this chat, never shown again (only its last four), and nobody is messaged.",
        "te": "మీ IndiaMART CRM కీని కింది కార్డులో పేస్ట్ చేయండి. అది నేరుగా లాక్ చేసిన స్టోర్‌కు వెళ్తుంది: ఈ చాట్‌లో ఉండదు, మళ్ళీ చూపించను (చివరి నాలుగు అక్షరాలు మాత్రమే), ఎవరికీ మెసేజ్ వెళ్ళదు.",
        "hi": "अपनी IndiaMART CRM key नीचे के कार्ड में पेस्ट करें। यह सीधे एक बंद स्टोर में जाती है: इस चैट में नहीं आती, दोबारा नहीं दिखती (सिर्फ़ आख़िरी चार अक्षर), और किसी को मैसेज नहीं जाता।",
        "kn": "ನಿಮ್ಮ IndiaMART CRM ಕೀಯನ್ನು ಕೆಳಗಿನ ಕಾರ್ಡ್‌ನಲ್ಲಿ ಪೇಸ್ಟ್ ಮಾಡಿ. ಅದು ನೇರವಾಗಿ ಲಾಕ್ ಮಾಡಿದ ಸ್ಟೋರ್‌ಗೆ ಹೋಗುತ್ತದೆ: ಈ ಚಾಟ್‌ನಲ್ಲಿ ಇರುವುದಿಲ್ಲ, ಮತ್ತೆ ತೋರಿಸುವುದಿಲ್ಲ (ಕೊನೆಯ ನಾಲ್ಕು ಅಕ್ಷರ ಮಾತ್ರ), ಯಾರಿಗೂ ಮೆಸೇಜ್ ಹೋಗುವುದಿಲ್ಲ.",
    },
    "key_owner_only": {
        "en": "Only the owner can add the business's IndiaMART key.",
        "te": "వ్యాపారం IndiaMART కీని యజమాని మాత్రమే చేర్చగలరు.",
        "hi": "बिज़नेस की IndiaMART key सिर्फ़ मालिक जोड़ सकते हैं।",
        "kn": "ವ್ಯಾಪಾರದ IndiaMART ಕೀಯನ್ನು ಮಾಲೀಕರು ಮಾತ್ರ ಸೇರಿಸಬಹುದು.",
    },
    "key_not_yet": {
        "en": "I can't take your own IndiaMART key here yet. Lead sources shows how IndiaMART leads come in now.",
        "te": "మీ సొంత IndiaMART కీని ఇక్కడ ఇంకా తీసుకోలేను. IndiaMART లీడ్స్ ఇప్పుడు ఎలా వస్తాయో లీడ్ సోర్స్‌లలో చూడవచ్చు.",
        "hi": "आपकी अपनी IndiaMART key मैं यहाँ अभी नहीं ले सकती। IndiaMART लीड अभी कैसे आती हैं, यह लीड सोर्स में दिखता है।",
        "kn": "ನಿಮ್ಮ ಸ್ವಂತ IndiaMART ಕೀಯನ್ನು ಇಲ್ಲಿ ಇನ್ನೂ ತೆಗೆದುಕೊಳ್ಳಲಾರೆ. IndiaMART ಲೀಡ್‌ಗಳು ಈಗ ಹೇಗೆ ಬರುತ್ತವೆ ಎಂದು ಲೀಡ್ ಸೋರ್ಸ್‌ಗಳಲ್ಲಿ ನೋಡಬಹುದು.",
    },
    "unavailable": {
        "en": "I can't change that from the chat right now. The screen can.",
        "te": "అది ఇప్పుడు చాట్ నుండి మార్చలేను. స్క్రీన్‌లో మార్చవచ్చు.",
        "hi": "यह अभी चैट से नहीं बदल सकती। स्क्रीन पर बदल सकते हैं।",
        "kn": "ಅದನ್ನು ಈಗ ಚಾಟ್‌ನಿಂದ ಬದಲಿಸಲಾರೆ. ಸ್ಕ್ರೀನ್‌ನಲ್ಲಿ ಬದಲಿಸಬಹುದು.",
    },
}
DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def w(key: str, language: Language, **kw: Any) -> str:
    return WORDS[key].get(language, WORDS[key]["en"]).format(**kw)


def hhmm(minute: int) -> str:
    return f"{minute // 60:02d}:{minute % 60:02d}"


def hours_words(hours: dict[str, Any] | None) -> str:
    if not hours:
        return "the assistant's own hours"
    days = sorted(int(d) for d in hours.get("days") or [])
    span = f"{DAY_NAMES[days[0] - 1]}-{DAY_NAMES[days[-1] - 1]}" if days and days == list(range(days[0], days[-1] + 1)) else ", ".join(DAY_NAMES[d - 1] for d in days)
    return f"{span} {hhmm(int(hours['from_minute']))}-{hhmm(int(hours['to_minute']))}"


class RouteTurn:
    """What the assistant answers for a routed request: (the sentence, the card)."""

    def __init__(self, store: WorkStore, tools: Tools, lead_sources: Any, secrets: Any = None) -> None:
        self.store, self.tools, self.lead_sources, self.secrets = store, tools, lead_sources, secrets

    def _read(self, tenant_id: uuid.UUID, token: str, tool: str, message_id: uuid.UUID) -> Any | None:
        got = asyncio.run(self.tools.run(tenant_id, token, executor.Call(tool=tool), message_id))
        return got.answer if got.ok else None

    def _plan(self, token: str, tenant_id: uuid.UUID, message_id: uuid.UUID, conversation_id: uuid.UUID | None, title: str, step: dict[str, Any], *, sensitive: str | None = None,
              owner_only: bool = False, second_factor: bool = False) -> dict[str, Any]:
        plan_id = uuid.uuid4()
        return self.store.plan_put(token, tenant_id, {
            "plan_id": str(plan_id), "message_id": str(message_id), "conversation_id": str(conversation_id) if conversation_id else None, "file_id": None, "title": title[:200],
            "file_name": None, "sensitive": sensitive, "owner_only": owner_only, "needs_second_factor": second_factor, "card": {"kind": "plan", "destination": "settings"},
            "steps": [{"status": "proposed", "error": None, **step}],
        })

    def answer(self, token: str, tenant_id: uuid.UUID, routed: Routed, *, message_id: uuid.UUID, conversation_id: uuid.UUID | None, language: Language) -> tuple[str, dict[str, Any] | None]:
        if routed.decision == "clarify":
            return routed.question or w("clarify", language), None
        if routed.decision == "cant_do":
            screen = routed.screen if routed.screen in SCREENS else "billing"
            what = SCREEN_WHAT[screen].get(language, SCREEN_WHAT[screen]["en"])
            return w("screen_only", language, what=what), cant_do("screen_only", what, SCREENS[screen])
        a = routed.action
        if a == "calling_hours":
            return self._calling_hours(token, tenant_id, routed.args, message_id, conversation_id, language)
        if a == "auto_reply":
            return self._auto_reply(token, tenant_id, bool(routed.args["on"]), message_id, conversation_id, language)
        if a in ("pause_source", "resume_source"):
            return self._source(token, tenant_id, a, str(routed.args["source"]), message_id, conversation_id, language)
        if a == "add_lead":
            return self._add_lead(token, tenant_id, routed.args, message_id, conversation_id, language)
        if a == "remove_example_data":
            return self._example(token, tenant_id, message_id, conversation_id, language)
        if a == "source_key":
            return self._source_key(token, tenant_id, message_id, language)
        return w("clarify", language), None

    def _source_key(self, token: str, tenant_id: uuid.UUID, message_id: uuid.UUID, language: Language) -> tuple[str, dict[str, Any] | None]:
        """The secure card (contract section 2, `secret`): a request the Owner's card sends the key to, good for 15 minutes and once. The key never comes back here."""
        sources = {"label": "Lead sources", "href": "/lead-sources"}
        if self.secrets is None:
            return w("key_not_yet", language), cant_do("not_yet", "your own IndiaMART key", sources)
        from app.tenancy.repository import Forbidden

        try:
            opened = self.secrets.open(token, tenant_id, "indiamart_key", message_id)
        except Forbidden:
            return w("key_owner_only", language), None
        saved = opened.get("saved")
        return w("key_card", language), {
            "kind": "secret", "id": str(uuid.uuid4()), "request_id": str(opened["request_id"]), "secret": "indiamart_key", "title": "Your IndiaMART CRM key",
            "hint": "IndiaMART Lead Manager -> Settings -> CRM key (Import/Export Leads)", "expires_at": str(opened.get("expires_at") or ""),
            "saved": {"last4": saved.get("last4")} if isinstance(saved, dict) else None,
        }

    def _calling_hours(self, token: str, tenant_id: uuid.UUID, args: dict[str, Any], message_id: uuid.UUID, conversation_id: uuid.UUID | None, language: Language) -> tuple[str, dict[str, Any] | None]:
        read = self._read(tenant_id, token, "call-settings.get_settings", message_id)
        current = read.get("settings") if isinstance(read, dict) else None   # the read wraps the settings in force (what was saved, or the business type's defaults)
        if not isinstance(current, dict):
            return w("unavailable", language), None
        before = current.get("hours")
        days = args.get("days") or (before or {}).get("days") or [1, 2, 3, 4, 5, 6]
        after = {"days": sorted(int(d) for d in days), "from_minute": int(args["from_minute"]), "to_minute": int(args["to_minute"])}
        summary = f"Calling hours: {hours_words(before)} -> {hours_words(after)}"
        if before == after:
            return w("same", language, summary=hours_words(after)), None
        body = {**current, "hours": after}
        plan = self._plan(token, tenant_id, message_id, conversation_id, summary, {"tool": "call-settings.put_settings", "summary": summary, "undoable": True, "call": {"path": {}, "body": body}},
                          owner_only=True, second_factor=True)
        return w("offer", language, summary=summary), card_of_plan(plan)

    def _auto_reply(self, token: str, tenant_id: uuid.UUID, on: bool, message_id: uuid.UUID, conversation_id: uuid.UUID | None, language: Language) -> tuple[str, dict[str, Any] | None]:
        current = self._read(tenant_id, token, "ai-assistant.get_auto_reply", message_id)
        was = bool(current.get("enabled")) if isinstance(current, dict) else None
        summary = f"Automatic replies: {'on' if was else 'off' if was is not None else '?'} -> {'on' if on else 'off'}"
        if was is on:
            return w("same", language, summary=f"automatic replies {'on' if on else 'off'}"), None
        plan = self._plan(token, tenant_id, message_id, conversation_id, summary, {"tool": "ai-assistant.put_auto_reply", "summary": summary, "undoable": True, "call": {"path": {}, "body": {"enabled": on}}},
                          sensitive="sending" if on else None, owner_only=True, second_factor=True)
        return w("offer", language, summary=summary), card_of_plan(plan)

    def _source(self, token: str, tenant_id: uuid.UUID, action: str, source: str, message_id: uuid.UUID, conversation_id: uuid.UUID | None, language: Language) -> tuple[str, dict[str, Any] | None]:
        listed = self._read(tenant_id, token, "lead-sources.list_sources", message_id)
        items = [i for i in (listed or {}).get("items") or [] if isinstance(i, dict)] if isinstance(listed, dict) else []
        key = "".join(ch for ch in source.casefold() if ch.isalnum())
        found = [i for i in items if key and (key in "".join(ch for ch in str(i.get("label") or "").casefold() if ch.isalnum()) or key == str(i.get("tag") or "").replace("_", ""))]
        if len(found) != 1:
            return w("no_source", language, source=source, names=", ".join(str(i.get("label") or "") for i in items) or "-"), None
        item = found[0]
        pause = action == "pause_source"
        summary = f"{item.get('label')}: {item.get('status')} -> {'paused' if pause else 'active'}"
        if item.get("status") == ("paused" if pause else "active"):
            return w("same", language, summary=f"{item.get('label')} is {item.get('status')}"), None
        plan = self._plan(token, tenant_id, message_id, conversation_id, summary,
                          {"tool": "lead-sources.pause_source" if pause else "lead-sources.resume_source", "summary": summary, "undoable": True, "call": {"path": {"source_id": str(item["id"])}}})
        return w("offer", language, summary=summary), card_of_plan(plan)

    def _add_lead(self, token: str, tenant_id: uuid.UUID, args: dict[str, Any], message_id: uuid.UUID, conversation_id: uuid.UUID | None, language: Language) -> tuple[str, dict[str, Any] | None]:
        """One person, typed: the lead import's own preview and dedupe (a known number is merged, not doubled), the same import card and Undo as a file."""
        out = io.StringIO()
        csv.writer(out).writerows([["Name", "Phone", "Email", "City"], [args["name"], args.get("phone") or "", args.get("email") or "", args.get("city") or ""]])
        sheet_b64 = base64.b64encode(out.getvalue().encode("utf-8")).decode("ascii")
        kept = self.store.file_put(token, tenant_id, "typed lead.csv", "text/csv", "sheet", sheet_b64)
        turn = FileTurn(self.store, self.tools, self.lead_sources)
        return turn._lead_list(token, tenant_id, uuid.UUID(str(kept["file_id"])), f"{args['name']} (typed)", "sheet", sheet_b64, message_id=message_id, conversation_id=conversation_id, language=language)

    def _example(self, token: str, tenant_id: uuid.UUID, message_id: uuid.UUID, conversation_id: uuid.UUID | None, language: Language) -> tuple[str, dict[str, Any] | None]:
        status = self._read(tenant_id, token, "example-data.example_status", message_id)
        counts = status.get("counts") if isinstance(status, dict) else None
        total = sum(int(v or 0) for v in counts.values() if isinstance(v, int)) if isinstance(counts, dict) else 0
        if not (isinstance(status, dict) and status.get("loaded")) or not total:
            return w("no_example", language), None
        summary = f"Remove the example data ({total} example rows; your own data stays)"
        plan = self._plan(token, tenant_id, message_id, conversation_id, summary, {"tool": "example-data.example_remove", "summary": summary, "undoable": False, "call": {"path": {}}},
                          sensitive="deleting", owner_only=True)
        return w("offer", language, summary=summary), card_of_plan(plan)
