"""The file path, end to end (job assistant-does-the-work A2; owner, 4 Nov 2026: "upload in chat -> detect what it is -> leads import with the preview card -> plan card -> Do it -> Undo").

  1. POST /assistant/files            the bytes are kept (at most 24 h, only the person who dropped them reads them back);
  2. the turn names the file           the kind is decided by code; a sheet, a vCard or a text list is READ and PREVIEWED by the lead import's own routes (column matching with rules and the AI matcher,
                                       the dedupe, the counts), called through the application with the person's token like any tool. Nothing is written. The answer is a `file_preview` card with
                                       its plan (one step: the import), or a `cant_do` card when the file is not a lead list (a price list, a brochure: not yet);
  3. "Do it"                          the plan moves to running (compare-and-set: a double tap runs it once), the step runs the import route with the file's bytes, the action log records it with its
                                       undo, the file is deleted;
  4. Undo                             the import's own undo route archives what it created and nobody has worked on since.
Imported people are never messaged or called because of this (the normal rules decide that). The model never sees the file: the AI column matcher sees headers and a few samples, as on the screen."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
import base64
import csv
import io
import logging
import re
import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

import httpx

from app.agent_runs import pause
from app.assistant.language import Language
from app.assistant_tools import executor
from app.assistant_work import extract
from app.assistant_work.files import MAX_LEADS_FILE_BYTES, MAX_ROWS
from app.assistant_work.store import PlanExpiredError, PlanStateError, WorkStore
from app.errors import ApiError

logger = logging.getLogger("app.assistant_work")

IMPORT_TOOL = "lead-imports.import_leads"
READ_TOOL = "lead-imports.read_import"
PREVIEW_TOOL = "lead-imports.preview_import"
SOURCE_OF = {"sheet": "excel_upload", "contacts": "vcard", "text": "pasted_list"}
READ_KIND_OF = {"sheet": "file", "contacts": "vcard", "text": "paste"}
_PRICE_WORDS = re.compile(r"(price|rate|mrp|cost|sku|item|product|qty|quantity|stock|ధర|कीमत|दाम|ಬೆಲೆ)", re.IGNORECASE)
_NS = uuid.UUID("7b6f7c2e-2b8e-4f7e-9a51-3c0d5a6f4e11")

_CATALOGUES: dict[int, executor.Catalogue] = {}


def catalogue_of(app: Any) -> executor.Catalogue:
    """The tool catalogue of THIS application, decided once per process from its own route list."""
    key = id(app)
    if key not in _CATALOGUES:
        _CATALOGUES[key] = executor.Catalogue(app.openapi())
    return _CATALOGUES[key]


class Tools:
    """Runs a tool through the application itself (app/assistant_tools/executor.py): the same route the screens call, with the person's token."""

    def __init__(self, app: Any) -> None:
        self.app = app
        self.catalogue = catalogue_of(app)

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app), base_url="http://assistant.internal", timeout=httpx.Timeout(120.0))

    async def run(self, tenant_id: uuid.UUID, token: str, call: executor.Call, message_id: uuid.UUID | None = None) -> executor.Result:
        async with self._client() as client:
            return await executor.run(client, self.catalogue, tenant_id, token, call, message_id)

    async def undo(self, tenant_id: uuid.UUID, token: str, how: dict[str, Any], message_id: uuid.UUID | None = None) -> executor.Result:
        async with self._client() as client:
            return await executor.undo(client, self.catalogue, tenant_id, token, how, message_id)


# ---------------------------------------------------------------------------------------------------------------------------------- the words
WORDS: dict[str, dict[str, str]] = {
    "offer": {
        "en": "I read '{name}': {found} people, {existing} already in your leads. Shall I add the {new} new ones? Nobody is sent anything.",
        "te": "'{name}' చదివాను: {found} మంది, వారిలో {existing} మంది ఇప్పటికే మీ లీడ్స్‌లో ఉన్నారు. కొత్త {new} మందిని చేర్చమంటారా? ఎవరికీ ఏమీ పంపను.",
        "hi": "'{name}' पढ़ ली: {found} लोग, जिनमें {existing} पहले से आपकी लीड्स में हैं। नए {new} लोगों को जोड़ दूँ? किसी को कुछ भेजा नहीं जाएगा।",
        "kn": "'{name}' ಓದಿದೆ: {found} ಜನ, ಅವರಲ್ಲಿ {existing} ಜನ ಈಗಾಗಲೇ ನಿಮ್ಮ ಲೀಡ್‌ಗಳಲ್ಲಿ ಇದ್ದಾರೆ. ಹೊಸ {new} ಜನರನ್ನು ಸೇರಿಸಲೇ? ಯಾರಿಗೂ ಏನೂ ಕಳುಹಿಸುವುದಿಲ್ಲ.",
    },
    "nothing_new": {
        "en": "I read '{name}': all {found} are already in your leads. There is nothing new to add.",
        "te": "'{name}' చదివాను: {found} మందీ ఇప్పటికే మీ లీడ్స్‌లో ఉన్నారు. చేర్చడానికి కొత్తవారు ఎవరూ లేరు.",
        "hi": "'{name}' पढ़ ली: सभी {found} लोग पहले से आपकी लीड्स में हैं। जोड़ने के लिए कोई नया नहीं है।",
        "kn": "'{name}' ಓದಿದೆ: {found} ಜನರೂ ಈಗಾಗಲೇ ನಿಮ್ಮ ಲೀಡ್‌ಗಳಲ್ಲಿ ಇದ್ದಾರೆ. ಸೇರಿಸಲು ಹೊಸಬರು ಯಾರೂ ಇಲ್ಲ.",
    },
    "nobody": {
        "en": "I read '{name}' but found nobody with a phone number or an e-mail in it.",
        "te": "'{name}' చదివాను, కానీ అందులో ఫోన్ నంబర్ లేదా ఇమెయిల్ ఉన్నవారు ఎవరూ లేరు.",
        "hi": "'{name}' पढ़ ली, पर उसमें फ़ोन नंबर या ई-मेल वाला कोई नहीं मिला।",
        "kn": "'{name}' ಓದಿದೆ, ಆದರೆ ಅದರಲ್ಲಿ ಫೋನ್ ನಂಬರ್ ಅಥವಾ ಇಮೇಲ್ ಇರುವವರು ಯಾರೂ ಇಲ್ಲ.",
    },
    "cant": {
        "en": "I can't do this with '{name}' yet: {what}. The screen can.",
        "te": "'{name}' తో ఇది నేను ఇంకా చేయలేను: {what}. స్క్రీన్‌లో చేయవచ్చు.",
        "hi": "'{name}' के साथ यह मैं अभी नहीं कर सकती: {what}। स्क्रीन पर हो सकता है।",
        "kn": "'{name}' ಜೊತೆ ಇದನ್ನು ನಾನು ಇನ್ನೂ ಮಾಡಲಾರೆ: {what}. ಸ್ಕ್ರೀನ್‌ನಲ್ಲಿ ಮಾಡಬಹುದು.",
    },
    "unreadable": {
        "en": "I couldn't read '{name}'. A sheet (.xlsx or .csv), a contacts file (.vcf), a text list, a PDF, a Word file (.docx) or a photo (.jpg, .png) works.",
        "te": "'{name}' చదవలేకపోయాను. షీట్ (.xlsx లేదా .csv), కాంటాక్ట్స్ ఫైల్ (.vcf), టెక్స్ట్ జాబితా, PDF, Word ఫైల్ (.docx) లేదా ఫోటో (.jpg, .png) పనిచేస్తుంది.",
        "hi": "'{name}' पढ़ नहीं पाई। शीट (.xlsx या .csv), कॉन्टैक्ट फ़ाइल (.vcf), टेक्स्ट सूची, PDF, Word फ़ाइल (.docx) या फ़ोटो (.jpg, .png) चलेगी।",
        "kn": "'{name}' ಓದಲಾಗಲಿಲ್ಲ. ಶೀಟ್ (.xlsx ಅಥವಾ .csv), ಕಾಂಟ್ಯಾಕ್ಟ್ ಫೈಲ್ (.vcf), ಪಠ್ಯ ಪಟ್ಟಿ, PDF, Word ಫೈಲ್ (.docx) ಅಥವಾ ಫೋಟೋ (.jpg, .png) ಆಗುತ್ತದೆ.",
    },
    "from_picture": {
        "en": " I read it from the picture: please check the names and numbers before you say yes.",
        "te": " ఇది చిత్రం నుండి చదివాను: అవును అనే ముందు పేర్లు, నంబర్లు ఒకసారి చూడండి.",
        "hi": " यह मैंने तस्वीर से पढ़ा है: हाँ कहने से पहले नाम और नंबर एक बार देख लें।",
        "kn": " ಇದನ್ನು ಚಿತ್ರದಿಂದ ಓದಿದೆ: ಹೌದು ಎನ್ನುವ ಮೊದಲು ಹೆಸರುಗಳು, ನಂಬರ್‌ಗಳನ್ನು ಒಮ್ಮೆ ನೋಡಿ.",
    },
    "doc_format": {
        "en": "I can read Word files saved as .docx. Save '{name}' as .docx (or as Excel or CSV) and drop it again, please.",
        "te": ".docx గా సేవ్ చేసిన Word ఫైల్స్ చదవగలను. దయచేసి '{name}' ను .docx గా (లేదా Excel, CSV గా) సేవ్ చేసి మళ్ళీ వేయండి.",
        "hi": "मैं .docx में सेव की गई Word फ़ाइलें पढ़ सकती हूँ। कृपया '{name}' को .docx (या Excel, CSV) में सेव करके फिर से डालें।",
        "kn": ".docx ಆಗಿ ಸೇವ್ ಮಾಡಿದ Word ಫೈಲ್‌ಗಳನ್ನು ಓದಬಲ್ಲೆ. ದಯವಿಟ್ಟು '{name}' ಅನ್ನು .docx (ಅಥವಾ Excel, CSV) ಆಗಿ ಸೇವ್ ಮಾಡಿ ಮತ್ತೆ ಹಾಕಿ.",
    },
    "scanned_school": {
        "en": "I can't read scanned files yet: please upload '{name}' as Excel or CSV.",
        "te": "స్కాన్ చేసిన ఫైల్స్ నేను ఇంకా చదవలేను: దయచేసి '{name}' ను Excel లేదా CSV గా అప్‌లోడ్ చేయండి.",
        "hi": "स्कैन की गई फ़ाइलें मैं अभी नहीं पढ़ सकती: कृपया '{name}' को Excel या CSV में अपलोड करें।",
        "kn": "ಸ್ಕ್ಯಾನ್ ಮಾಡಿದ ಫೈಲ್‌ಗಳನ್ನು ನಾನು ಇನ್ನೂ ಓದಲಾರೆ: ದಯವಿಟ್ಟು '{name}' ಅನ್ನು Excel ಅಥವಾ CSV ಆಗಿ ಅಪ್‌ಲೋಡ್ ಮಾಡಿ.",
    },
    "no_reader": {
        "en": "I couldn't read the scanned pages of '{name}' right now. Please upload it as Excel or CSV, or try again later.",
        "te": "'{name}' లోని స్కాన్ చేసిన పేజీలు ఇప్పుడు చదవలేకపోయాను. దయచేసి Excel లేదా CSV గా అప్‌లోడ్ చేయండి, లేదా కాసేపు తర్వాత ప్రయత్నించండి.",
        "hi": "'{name}' के स्कैन किए पन्ने अभी नहीं पढ़ पाई। कृपया इसे Excel या CSV में अपलोड करें, या थोड़ी देर बाद फिर कोशिश करें।",
        "kn": "'{name}' ನ ಸ್ಕ್ಯಾನ್ ಮಾಡಿದ ಪುಟಗಳನ್ನು ಈಗ ಓದಲಾಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು Excel ಅಥವಾ CSV ಆಗಿ ಅಪ್‌ಲೋಡ್ ಮಾಡಿ, ಅಥವಾ ಸ್ವಲ್ಪ ಹೊತ್ತಿನ ನಂತರ ಪ್ರಯತ್ನಿಸಿ.",
    },
    "ai_limit": {
        "en": "Today's AI allowance is used up, so I couldn't read the scanned pages of '{name}'. Please upload it as Excel or CSV, or try again tomorrow.",
        "te": "ఈరోజు AI పరిమితి అయిపోయింది, అందుకే '{name}' లోని స్కాన్ చేసిన పేజీలు చదవలేకపోయాను. దయచేసి Excel లేదా CSV గా అప్‌లోడ్ చేయండి, లేదా రేపు ప్రయత్నించండి.",
        "hi": "आज की AI सीमा पूरी हो गई है, इसलिए '{name}' के स्कैन किए पन्ने नहीं पढ़ पाई। कृपया इसे Excel या CSV में अपलोड करें, या कल फिर कोशिश करें।",
        "kn": "ಇಂದಿನ AI ಮಿತಿ ಮುಗಿದಿದೆ, ಹಾಗಾಗಿ '{name}' ನ ಸ್ಕ್ಯಾನ್ ಮಾಡಿದ ಪುಟಗಳನ್ನು ಓದಲಾಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು Excel ಅಥವಾ CSV ಆಗಿ ಅಪ್‌ಲೋಡ್ ಮಾಡಿ, ಅಥವಾ ನಾಳೆ ಪ್ರಯತ್ನಿಸಿ.",
    },
    "heic": {
        "en": "I can't open HEIC photos. Send '{name}' as a JPG or PNG, please (a screenshot works too).",
        "te": "HEIC ఫోటోలు నేను తెరవలేను. దయచేసి '{name}' ను JPG లేదా PNG గా పంపండి (స్క్రీన్‌షాట్ కూడా పనిచేస్తుంది).",
        "hi": "HEIC फ़ोटो मैं नहीं खोल सकती। कृपया '{name}' को JPG या PNG में भेजें (स्क्रीनशॉट भी चलेगा)।",
        "kn": "HEIC ಫೋಟೋಗಳನ್ನು ನಾನು ತೆರೆಯಲಾರೆ. ದಯವಿಟ್ಟು '{name}' ಅನ್ನು JPG ಅಥವಾ PNG ಆಗಿ ಕಳುಹಿಸಿ (ಸ್ಕ್ರೀನ್‌ಶಾಟ್ ಕೂಡ ಆಗುತ್ತದೆ).",
    },
    "gone": {
        "en": "That file is no longer here (files are kept for a day). Drop it again, please.",
        "te": "ఆ ఫైల్ ఇప్పుడు లేదు (ఫైల్స్ ఒక్క రోజు మాత్రమే ఉంటాయి). దయచేసి మళ్ళీ వేయండి.",
        "hi": "वह फ़ाइल अब नहीं है (फ़ाइलें एक दिन रखी जाती हैं)। कृपया फिर से डालें।",
        "kn": "ಆ ಫೈಲ್ ಈಗ ಇಲ್ಲ (ಫೈಲ್‌ಗಳು ಒಂದು ದಿನ ಮಾತ್ರ ಇರುತ್ತವೆ). ದಯವಿಟ್ಟು ಮತ್ತೆ ಹಾಕಿ.",
    },
}
WHAT = {
    "price_list": {"en": "adding a price list from a file", "te": "ఫైల్ నుండి ధరల జాబితా చేర్చడం", "hi": "फ़ाइल से कीमतों की सूची जोड़ना", "kn": "ಫೈಲ್‌ನಿಂದ ಬೆಲೆ ಪಟ್ಟಿ ಸೇರಿಸುವುದು"},
    "document": {"en": "reading a document or a picture into your business", "te": "డాక్యుమెంట్ లేదా చిత్రాన్ని మీ వ్యాపారంలోకి చదవడం", "hi": "दस्तावेज़ या तस्वीर को आपके कारोबार में पढ़ना", "kn": "ದಾಖಲೆ ಅಥವಾ ಚಿತ್ರವನ್ನು ನಿಮ್ಮ ವ್ಯಾಪಾರಕ್ಕೆ ಓದುವುದು"},
    "too_big": {"en": "importing a list bigger than 3 MB", "te": "3 MB కంటే పెద్ద జాబితాను దిగుమతి చేయడం", "hi": "3 MB से बड़ी सूची आयात करना", "kn": "3 MB ಗಿಂತ ದೊಡ್ಡ ಪಟ್ಟಿಯನ್ನು ಆಮದು ಮಾಡುವುದು"},
    "scanned": {"en": "reading scanned pages", "te": "స్కాన్ చేసిన పేజీలు చదవడం", "hi": "स्कैन किए पन्ने पढ़ना", "kn": "ಸ್ಕ್ಯಾನ್ ಮಾಡಿದ ಪುಟಗಳನ್ನು ಓದುವುದು"},
    "too_many": {"en": "importing more than 5,000 rows at once", "te": "ఒకేసారి 5,000 వరుసలకంటే ఎక్కువ దిగుమతి చేయడం", "hi": "एक बार में 5,000 से ज़्यादा पंक्तियाँ आयात करना", "kn": "ಒಮ್ಮೆಗೆ 5,000 ಕ್ಕಿಂತ ಹೆಚ್ಚು ಸಾಲುಗಳನ್ನು ಆಮದು ಮಾಡುವುದು"},
}
TITLE = {"en": "Add {n} leads from '{name}'"}
STEP = {"en": "Add {n} new leads ({existing} already exist, left as they are)"}


def words(key: str, language: Language, **kw: Any) -> str:
    table = WORDS[key]
    return table.get(language, table["en"]).format(**kw)


def what(key: str, language: Language) -> str:
    return WHAT[key].get(language, WHAT[key]["en"])


# ---------------------------------------------------------------------------------------------------------------------------------- the cards
def public_plan(plan: dict[str, Any]) -> dict[str, Any]:
    """The plan as the card shows it (docs/contracts/assistant-tools.md section 2): never a step's arguments or its undo."""
    return {
        "plan_id": plan["plan_id"], "title": plan["title"], "status": plan["status"],
        "steps": [{"tool": s.get("tool"), "summary": s.get("summary"), "undoable": bool(s.get("undoable")), "status": s.get("status", "proposed"), "error": s.get("error")} for s in plan.get("steps") or []],
        "sensitive": plan.get("sensitive"), "owner_only": bool(plan.get("owner_only")), "needs_second_factor": bool(plan.get("needs_second_factor")), "expires_at": plan.get("expires_at"),
    }


def card_of_plan(plan: dict[str, Any], rows: list[list[str]] | None = None) -> dict[str, Any]:
    """The `file_preview` card of a stored plan (a replay and the stored chat show it in its state now; the file's rows only while the file is there, at the turn)."""
    card = plan.get("card") or {}
    return {"kind": "file_preview", "id": str(uuid.uuid5(_NS, str(plan["plan_id"]))), "file_name": plan.get("file_name") or "", "destination": card.get("destination", "leads"), "customer_name": None,
            "read_by": card.get("read_by") or "file", "facts": card.get("facts") or [], "columns": card.get("columns") or [], "rows": rows or [], "plan": public_plan(plan)}


def cant_do(reason: str, what_words: str, screen: dict[str, str] | None) -> dict[str, Any]:
    return {"kind": "cant_do", "id": str(uuid.uuid4()), "reason": reason, "what": what_words, "screen": screen}


def facts_of(counts: dict[str, Any], problems: list[dict[str, Any]], rows_read: int) -> list[dict[str, Any]]:
    new = int(counts.get("ready") or 0)
    existing = int(counts.get("duplicates_merged") or 0) + int(counts.get("already_imported") or 0)
    invalid = int(counts.get("invalid") or 0)
    sampled = [p for p in problems if p.get("reason") in ("no_contact_way", "invalid_number", "row_refused")]
    contact = sum(1 for p in sampled if p.get("reason") in ("no_contact_way", "invalid_number"))
    # the import names at most 50 problem rows: the split of ALL refused rows follows the rows it named
    no_phone = invalid if not sampled else round(invalid * contact / len(sampled))
    unreadable = invalid - no_phone
    out = [{"code": "found", "n": new + existing}, {"code": "existing", "n": existing}]
    for code, n in (("no_phone", no_phone), ("duplicate", int(counts.get("duplicates_in_file") or 0)), ("unreadable", unreadable), ("too_many", max(0, rows_read - MAX_ROWS))):
        if n:
            out.append({"code": code, "n": n})
    return out


# ---------------------------------------------------------------------------------------------------------------------------------- 2. a file in the turn
AI_ALLOWANCE_CODES = ("run_limit_reached", pause.CODE)
READ_BY = {"docx": "file", "text_layer": "file", "local_ocr": "local_ocr", "ai_vision": "ai"}


class FileTurn:
    """What the assistant answers for ONE file of a turn: (the sentence, the card).

    `school` says whether the workspace is a school (asked only for a scanned file); `vision` is the AI reader of page images (None: switched off). The extraction step (app/assistant_work/extract.py)
    decides when either is used."""

    def __init__(self, store: WorkStore, tools: Tools, lead_sources: Any, *, reader: extract.FileReader | None = None, school: Callable[[], bool] | None = None,
                 vision: extract.Vision | None = None) -> None:
        self.store, self.tools, self.lead_sources = store, tools, lead_sources
        self.reader = reader if reader is not None else extract.FileReader(None)
        self.school, self.vision = school, vision

    def answer(self, token: str, tenant_id: uuid.UUID, file_id: uuid.UUID, *, message_id: uuid.UUID, conversation_id: uuid.UUID | None, language: Language) -> tuple[str, dict[str, Any] | None]:
        try:
            f = self.store.file_get(token, tenant_id, file_id)
        except Exception:   # someone else's, expired or deleted: the database answers not found, the person hears it plainly
            return words("gone", language), None
        name, kind, size = str(f.get("name") or "file"), str(f.get("kind") or ""), int(f.get("size_bytes") or 0)
        if kind in ("pdf", "image", "doc"):
            return self._document(token, tenant_id, file_id, name, kind, str(f.get("data_base64") or ""), message_id=message_id, conversation_id=conversation_id, language=language)
        if kind not in READ_KIND_OF:
            return words("unreadable", language, name=name), None
        if size > MAX_LEADS_FILE_BYTES:
            return words("cant", language, name=name, what=what("too_big", language)), cant_do("not_yet", what("too_big", language), {"label": "Lead Desk", "href": "/leads/import"})
        return self._lead_list(token, tenant_id, file_id, name, kind, str(f.get("data_base64") or ""), message_id=message_id, conversation_id=conversation_id, language=language)

    # ---- a PDF, a Word file, a photo: read into text and tables first, then the same lead-import path as a sheet
    def _document(self, token: str, tenant_id: uuid.UUID, file_id: uuid.UUID, name: str, kind: str, data_base64: str, *, message_id: uuid.UUID, conversation_id: uuid.UUID | None,
                  language: Language) -> tuple[str, dict[str, Any] | None]:
        try:
            data = base64.b64decode(data_base64)
        except ValueError:
            return words("unreadable", language, name=name), None
        try:
            read = self.reader.read(kind, data, school=self._is_school, vision=self.vision)
        except extract.ReadRefused as exc:
            return self._refused(exc.code, name, language)
        except ApiError as exc:   # the AI reader: the day's allowance, the model busy or not set up
            logger.info("assistant file not read by the AI model: %s", exc.code)
            key = "ai_limit" if exc.code in AI_ALLOWANCE_CODES else "no_reader"
            return words(key, language, name=name), cant_do("not_yet", what("scanned", language), {"label": "Lead Desk", "href": "/leads/import"})
        logger.info("assistant file read: kind=%s how=%s pages=%d tables=%d", kind, read.how, read.pages, len(read.grids))
        grid = _people_grid(read)
        if grid is None:
            if any(g and any(_PRICE_WORDS.search(h) for h in g[0]) for g in read.grids):
                return words("cant", language, name=name, what=what("price_list", language)), cant_do("not_yet", what("price_list", language), {"label": "Catalogue", "href": "/catalogue"})
            if read.how in ("docx", "text_layer") and len(read.text) > 200:
                return words("cant", language, name=name, what=what("document", language)), cant_do("not_yet", what("document", language), {"label": "About my business", "href": "/settings/knowledge"})
            return words("nobody", language, name=name), None
        # what was read is kept as a small CSV (the same 24 h rule) and the file itself is deleted now: the plan's "Do it" imports exactly what the card showed
        out = io.StringIO()
        csv.writer(out).writerows(grid[: MAX_ROWS + 1])
        sheet_b64 = base64.b64encode(out.getvalue().encode("utf-8")).decode("ascii")
        derived = self.store.file_put(token, tenant_id, (name.rsplit(".", 1)[0] or "file")[:190] + ".csv", "text/csv", "sheet", sheet_b64)
        try:
            self.store.file_drop(token, tenant_id, file_id)
        except Exception as exc:   # the sweep deletes it at the latest after a day
            logger.warning("assistant file not deleted after reading: %s", exc.__class__.__name__)
        return self._lead_list(token, tenant_id, uuid.UUID(str(derived["file_id"])), name, "sheet", sheet_b64, message_id=message_id, conversation_id=conversation_id, language=language,
                               read_by=READ_BY[read.how])

    def _is_school(self) -> bool:
        """Fails closed: a workspace whose kind cannot be read is treated as a school, so its pictures stay here."""
        if self.school is None:
            return False
        try:
            return bool(self.school())
        except Exception:
            return True

    def _refused(self, code: str, name: str, language: Language) -> tuple[str, dict[str, Any] | None]:
        screen = {"label": "Lead Desk", "href": "/leads/import"}
        if code in ("doc_format", "scanned_school", "heic", "no_reader"):
            return words(code, language, name=name), cant_do("not_yet", what("scanned", language) if code in ("scanned_school", "no_reader") else what("document", language), screen)
        if code == "too_big":
            return words("cant", language, name=name, what=what("too_big", language)), cant_do("not_yet", what("too_big", language), screen)
        return words("unreadable", language, name=name), None

    # ---- a list of people (a sheet, a vCard, a text list, or what was read from a document): the lead import's own read and preview
    def _lead_list(self, token: str, tenant_id: uuid.UUID, file_id: uuid.UUID, name: str, kind: str, data_base64: str, *, message_id: uuid.UUID, conversation_id: uuid.UUID | None,
                   language: Language, read_by: str = "file") -> tuple[str, dict[str, Any] | None]:
        body = self._read_body(kind, name, data_base64)
        read = asyncio.run(self.tools.run(tenant_id, token, executor.Call(tool=READ_TOOL, body={**body, "use_ai": True}), message_id))
        if not read.ok and read.error == "limit":   # the AI column matcher is over the day's allowance: the rules alone
            read = asyncio.run(self.tools.run(tenant_id, token, executor.Call(tool=READ_TOOL, body={**body, "use_ai": False}), message_id))
        if not read.ok or not isinstance(read.answer, dict):
            return words("unreadable", language, name=name), None
        mapping = read.answer.get("mapping")
        columns = [str(c.get("header") or "") for c in read.answer.get("columns") or []]
        if read.answer.get("kind") == "file" and not (isinstance(mapping, dict) and ("phone" in mapping or "email" in mapping)):
            if any(_PRICE_WORDS.search(h) for h in columns):
                return words("cant", language, name=name, what=what("price_list", language)), cant_do("not_yet", what("price_list", language), {"label": "Catalogue", "href": "/catalogue"})
            return words("nobody", language, name=name), None
        if int(read.answer.get("rows") or 0) > MAX_ROWS:
            return words("cant", language, name=name, what=what("too_many", language)), cant_do("not_yet", what("too_many", language), {"label": "Lead Desk", "href": "/leads/import"})
        preview_body = {**body, "use_ai": False, "source": SOURCE_OF[kind], **({"mapping": mapping} if isinstance(mapping, dict) else {})}
        preview = asyncio.run(self.tools.run(tenant_id, token, executor.Call(tool=PREVIEW_TOOL, body=preview_body), message_id))
        if not preview.ok or not isinstance(preview.answer, dict):
            return words("unreadable", language, name=name), None
        counts = preview.answer.get("counts") or {}
        problems = preview.answer.get("problems") or []
        rows_read = int(preview.answer.get("rows_read") or 0)
        facts = facts_of(counts, problems, rows_read)
        new = int(counts.get("ready") or 0)
        existing = next(x["n"] for x in facts if x["code"] == "existing")
        found = next(x["n"] for x in facts if x["code"] == "found")
        rows = self._sample_rows(kind, body)
        picture = words("from_picture", language) if read_by in ("local_ocr", "ai") else ""
        if new == 0:
            sentence = words("nobody", language, name=name) if found == 0 else words("nothing_new", language, name=name, found=found)
            return sentence, {"kind": "file_preview", "id": str(uuid.uuid4()), "file_name": name, "destination": "leads", "customer_name": None, "read_by": read_by, "facts": facts, "columns": columns,
                              "rows": rows, "plan": None}
        plan_id = uuid.uuid4()
        step_body = {k: v for k, v in preview_body.items() if k not in ("content_base64", "text")}
        step_body["import_id"] = str(uuid.uuid5(_NS, f"import:{plan_id}"))   # idempotent: a retried run replays the same import
        plan = self.store.plan_put(token, tenant_id, {
            "plan_id": str(plan_id), "message_id": str(message_id), "conversation_id": str(conversation_id) if conversation_id else None, "file_id": str(file_id),
            "title": TITLE["en"].format(n=new, name=name)[:200], "file_name": name,
            "card": {"destination": "leads", "read_by": read_by, "facts": facts, "columns": columns[:40]},
            "steps": [{"tool": IMPORT_TOOL, "summary": STEP["en"].format(n=new, existing=existing), "undoable": True, "status": "proposed", "error": None,
                       "call": {"path": {}, "body": step_body, "file": kind}}],
        })
        return words("offer", language, name=name, found=found, existing=existing, new=new) + picture, card_of_plan(plan, rows)

    def _read_body(self, kind: str, name: str, data_base64: str) -> dict[str, Any]:
        if kind == "text":
            return {"kind": "paste", "filename": name, "text": _text_of(data_base64)}
        return {"kind": READ_KIND_OF[kind], "filename": name, "content_base64": data_base64}

    def _sample_rows(self, kind: str, body: dict[str, Any]) -> list[list[str]]:
        """At most 5 rows as written in the file (the card's sample), read by the lead import's own reader; nothing is kept."""
        if self.lead_sources is None:
            return []
        try:
            from types import SimpleNamespace

            loaded = self.lead_sources.load(SimpleNamespace(kind=body["kind"], content_base64=body.get("content_base64"), text=body.get("text"), sheet_url=None))
        except Exception:
            return []
        if loaded.grid is not None:
            return [[str(v)[:60] for v in r] for r in loaded.grid.rows[:5]]
        return [[str(r.get("name") or "")[:60], str(r.get("phone") or "")[:32], str(r.get("email") or "")[:60]] for r in (loaded.rows or [])[:5]]


def _contact_cells(grid: extract.Grid) -> int:
    return sum(1 for row in grid for cell in row if extract.phones_in(cell) or "@" in cell)


def _headed(grid: extract.Grid) -> extract.Grid:
    """A table whose first row is already people gets a header named by what its columns hold (Phone, Email, Name), so the column matcher finds them; a real header stays as it is."""
    if not (extract.phones_in(" ".join(grid[0])) or any("@" in c for c in grid[0])):
        return grid
    width = max(len(r) for r in grid)
    header: list[str] = []
    for col in range(width):
        cells = [r[col] for r in grid if col < len(r)]
        if sum(1 for c in cells if extract.phones_in(c)) * 2 >= len(cells):
            header.append("Phone" if "Phone" not in header else f"Phone {col + 1}")
        elif sum(1 for c in cells if "@" in c) * 2 >= len(cells):
            header.append("Email" if "Email" not in header else f"Email {col + 1}")
        elif "Name" not in header and sum(1 for c in cells if sum(ch.isalpha() for ch in c) >= 3) * 2 >= len(cells):
            header.append("Name")
        else:
            header.append(f"Column {col + 1}")
    return [header, *[r + [""] * (width - len(r)) for r in grid]]


def _people_grid(read: extract.Extracted) -> extract.Grid | None:
    """The table of people in what was read: the table with the most phones and e-mails in it, else the people found line by line, else None."""
    tables = sorted((g for g in read.grids if _contact_cells(g) > 0), key=_contact_cells, reverse=True)
    if tables:
        return _headed(tables[0])
    people = extract.people_of_text(read.text)
    return people or None


def _text_of(data_base64: str) -> str:
    raw = base64.b64decode(data_base64 or "")
    for enc in ("utf-8-sig", "utf-16"):
        try:
            return raw.decode(enc)[:600_000]
        except UnicodeDecodeError:
            continue
    return raw.decode("latin-1")[:600_000]


# ---------------------------------------------------------------------------------------------------------------------------------- 3. "Do it" and 4. Undo
class PlanRunner:
    def __init__(self, store: WorkStore, tools: Tools) -> None:
        self.store, self.tools = store, tools

    def _get(self, token: str, tenant_id: uuid.UUID, plan_id: uuid.UUID) -> dict[str, Any]:
        try:
            return self.store.plan_get(token, tenant_id, plan_id)
        except ApiError:
            raise
        except Exception as exc:
            if exc.__class__.__name__ in ("NotFoundError",):
                raise ApiError(404, "not_found", "Not found.") from None
            raise

    def _move(self, token: str, tenant_id: uuid.UUID, plan_id: uuid.UUID, expect: str, status: str, steps: list[dict[str, Any]] | None = None, *, file_gone: bool = False) -> dict[str, Any]:
        try:
            return self.store.plan_move(token, tenant_id, plan_id, expect, status, steps, file_gone=file_gone)
        except PlanStateError:
            raise ApiError(409, "plan_state", "This plan is no longer waiting for an answer.") from None
        except PlanExpiredError:
            raise ApiError(409, "plan_expired", "This plan has expired. Ask again and I will make a new one.") from None

    def _drop(self, token: str, tenant_id: uuid.UUID, file_id: Any) -> None:
        if not file_id:
            return
        try:
            self.store.file_drop(token, tenant_id, uuid.UUID(str(file_id)))
        except Exception as exc:   # the sweep deletes it at the latest after a day
            logger.warning("assistant file not deleted after its plan: %s", exc.__class__.__name__)

    async def decide(self, token: str, tenant_id: uuid.UUID, plan_id: uuid.UUID, *, decision: str, confirmed: bool, is_owner: bool) -> dict[str, Any]:
        plan = self._get(token, tenant_id, plan_id)
        if decision == "cancel":
            moved = self._move(token, tenant_id, plan_id, "proposed", "cancelled", file_gone=True)
            self._drop(token, tenant_id, plan.get("file_id"))
            return moved
        if plan.get("owner_only") and not is_owner:
            raise ApiError(403, "forbidden", "Only the Owner can do this.")
        if plan.get("sensitive") and not confirmed:
            raise ApiError(409, "confirm_needed", "Confirm this on the card first.")
        self._move(token, tenant_id, plan_id, "proposed", "running")
        steps = [dict(s) for s in plan.get("steps") or []]
        message_id = uuid.UUID(str(plan["message_id"]))
        data: dict[str, Any] | None = None
        failed = False
        for no, step in enumerate(steps, start=1):
            if failed:
                step["status"] = "skipped"
                continue
            call_spec = step.get("call") or {}
            body = dict(call_spec.get("body") or {}) if isinstance(call_spec.get("body"), dict) else None
            if call_spec.get("file") and body is not None:
                if data is None:
                    try:
                        data = self.store.file_get(token, tenant_id, uuid.UUID(str(plan.get("file_id"))))
                    except Exception:
                        data = {}
                raw = str(data.get("data_base64") or "")
                if not raw:
                    step["status"], step["error"], failed = "failed", "not_found", True
                    self._log(token, tenant_id, plan_id, no, step, None, {})
                    continue
                if body.get("kind") == "paste":
                    body["text"] = _text_of(raw)
                else:
                    body["content_base64"] = raw
            call = executor.Call(tool=str(step.get("tool")), path=dict(call_spec.get("path") or {}), query=dict(call_spec.get("query") or {}), body=body)
            try:
                result = await self.tools.run(tenant_id, token, call, message_id)
            except executor.ToolRefused:
                step["status"], step["error"], failed = "failed", "invalid", True
                self._log(token, tenant_id, plan_id, no, step, None, {})
                continue
            step["status"] = "done" if result.ok else "failed"
            step["error"] = result.error
            step["undo"] = result.undo
            changed = _changed(step.get("tool"), result.answer) if result.ok else {}
            if result.ok and changed:
                step["changed"] = changed
            failed = not result.ok
            self._log(token, tenant_id, plan_id, no, step, result.undo if result.ok else None, changed)
        done = sum(1 for s in steps if s.get("status") == "done")
        final = "done" if done == len(steps) else ("partly_done" if done else "failed")
        moved = self._move(token, tenant_id, plan_id, "running", final, steps, file_gone=True)
        self._drop(token, tenant_id, plan.get("file_id"))
        logger.info("assistant plan ran: steps=%d done=%d status=%s", len(steps), done, final)
        return moved

    def _log(self, token: str, tenant_id: uuid.UUID, plan_id: uuid.UUID, no: int, step: dict[str, Any], undo: dict[str, Any] | None, changed: dict[str, Any]) -> None:
        try:
            self.store.action_record(token, tenant_id, plan_id, no, str(step.get("tool")), str(step.get("summary") or step.get("tool"))[:300], "done" if step.get("status") == "done" else "failed",
                                     step.get("error"), changed, undo)
        except Exception as exc:   # the change itself is done and audited by its own route; the action log line is reported, not retried
            logger.error("assistant action log not written: %s", exc.__class__.__name__)

    async def undo(self, token: str, tenant_id: uuid.UUID, plan_id: uuid.UUID) -> dict[str, Any]:
        plan = self._get(token, tenant_id, plan_id)
        if plan.get("status") not in ("done", "partly_done"):
            raise ApiError(409, "plan_state", "Only a plan that ran can be undone.")
        steps = [dict(s) for s in plan.get("steps") or []]
        message_id = uuid.UUID(str(plan["message_id"]))
        undone = 0
        for index in range(len(steps) - 1, -1, -1):   # newest first
            step = steps[index]
            how = step.get("undo")
            if step.get("status") != "done" or not isinstance(how, dict):
                continue
            try:
                result = await self.tools.undo(tenant_id, token, how, message_id)
            except executor.ToolRefused:
                step["error"] = "invalid"
                continue
            if result.ok:
                step["status"], step["error"] = "undone", None
                if isinstance(result.answer, dict) and "archived" in result.answer:
                    step["undo_result"] = {"archived": int(result.answer.get("archived") or 0), "kept": int(result.answer.get("kept") or 0)}
                undone += 1
                try:
                    self.store.action_undone(token, tenant_id, plan_id, index + 1)
                except Exception as exc:
                    logger.error("assistant action not marked undone: %s", exc.__class__.__name__)
            else:
                step["error"] = result.error
        if not undone:
            failed = next((s.get("error") for s in steps if s.get("error")), None)
            raise ApiError(403 if failed == "forbidden" else 409, "forbidden" if failed == "forbidden" else "nothing_to_undo",
                           "Only the Owner or an Admin can undo this." if failed == "forbidden" else "Nothing here can be undone.")
        return self._move(token, tenant_id, plan_id, str(plan["status"]), "undone", steps)


def _changed(tool: Any, answer: Any) -> dict[str, Any]:
    """What a step changed, in numbers (the action log's `changed`)."""
    if tool == IMPORT_TOOL and isinstance(answer, dict):
        counts = answer.get("counts") or {}
        return {"import_id": str(answer.get("import_id") or ""), "leads_added": int(counts.get("ready") or 0), "merged": int(counts.get("duplicates_merged") or 0)}
    return {}


def cards_for(runtime: Any, ctx: Any, message_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
    """The work cards of a stored chat, by reply id, in their state now (one read; nothing when the store is not configured). A file's rows are not kept, so a card read back has none."""
    store = getattr(runtime, "assistant_work", None)
    if store is None or not message_ids:
        return {}
    try:
        plans = store.plans_for(ctx.principal.token, ctx.tenant.id, [uuid.UUID(m) for m in message_ids][:200])
    except Exception as exc:
        logger.warning("assistant work cards could not be read: %s", exc.__class__.__name__)
        return {}
    out: dict[str, list[dict[str, Any]]] = {}
    for plan in plans:
        out.setdefault(str(plan.get("message_id")), []).append(card_of_plan(plan))
    return out


def now_utc() -> datetime:
    return datetime.now(UTC)
