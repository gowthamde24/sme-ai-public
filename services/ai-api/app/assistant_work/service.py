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
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import httpx

from app.agent_runs import pause
from app.assistant.language import Language
from app.assistant_tools import executor
from app.assistant_work import extract
from app.assistant_work.files import MAX_LEADS_FILE_BYTES, MAX_ROWS
from app.assistant_work.planner import Planned
from app.assistant_work.store import PlanExpiredError, PlanStateError, WorkStore
from app.assistant_work.understand import Understanding, understand
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
    "also_knowledge": {
        "en": " I'll also save its text to About my business.",
        "te": " దాని టెక్స్ట్‌ను 'నా వ్యాపారం గురించి' లో కూడా సేవ్ చేస్తాను.",
        "hi": " इसका टेक्स्ट 'मेरे कारोबार के बारे में' में भी सेव कर दूँगी।",
        "kn": " ಅದರ ಪಠ್ಯವನ್ನು 'ನನ್ನ ವ್ಯಾಪಾರದ ಬಗ್ಗೆ' ಯಲ್ಲೂ ಸೇವ್ ಮಾಡುತ್ತೇನೆ.",
    },
    "cant_part": {
        "en": " I can't do the rest yet ({what}): the screen can.",
        "te": " మిగతాది ({what}) నేను ఇంకా చేయలేను: స్క్రీన్‌లో చేయవచ్చు.",
        "hi": " बाकी ({what}) मैं अभी नहीं कर सकती: स्क्रीन पर हो सकता है।",
        "kn": " ಉಳಿದದ್ದನ್ನು ({what}) ನಾನು ಇನ್ನೂ ಮಾಡಲಾರೆ: ಸ್ಕ್ರೀನ್‌ನಲ್ಲಿ ಮಾಡಬಹುದು.",
    },
    "prices_offer": {
        "en": "I read '{name}': {found} prices, {changed} different from your catalogue ({unchanged} the same, {missing} not in your catalogue). Shall I change those {changed}? The card shows each old and new price. Only the Owner can do this, with the sign-in's second step.",
        "te": "'{name}' చదివాను: {found} ధరలు, వాటిలో {changed} మీ కేటలాగ్‌కు భిన్నంగా ఉన్నాయి ({unchanged} అలాగే ఉన్నాయి, {missing} కేటలాగ్‌లో లేవు). ఆ {changed} మార్చమంటారా? కార్డులో ప్రతి పాత, కొత్త ధర చూపిస్తాను. ఇది ఓనర్ మాత్రమే, సైన్-ఇన్ రెండో దశతో చేయగలరు.",
        "hi": "'{name}' पढ़ ली: {found} कीमतें, जिनमें {changed} आपके कैटलॉग से अलग हैं ({unchanged} वही हैं, {missing} कैटलॉग में नहीं हैं)। क्या वे {changed} बदल दूँ? कार्ड पर हर पुरानी और नई कीमत दिखेगी। यह सिर्फ़ ओनर, साइन-इन के दूसरे चरण के साथ कर सकते हैं।",
        "kn": "'{name}' ಓದಿದೆ: {found} ಬೆಲೆಗಳು, ಅವುಗಳಲ್ಲಿ {changed} ನಿಮ್ಮ ಕ್ಯಾಟಲಾಗ್‌ಗಿಂತ ಬೇರೆ ಇವೆ ({unchanged} ಹಾಗೆಯೇ ಇವೆ, {missing} ಕ್ಯಾಟಲಾಗ್‌ನಲ್ಲಿ ಇಲ್ಲ). ಆ {changed} ಬದಲಿಸಲೇ? ಕಾರ್ಡ್‌ನಲ್ಲಿ ಪ್ರತಿ ಹಳೆಯ ಮತ್ತು ಹೊಸ ಬೆಲೆ ತೋರಿಸುತ್ತೇನೆ. ಇದನ್ನು ಮಾಲೀಕರು ಮಾತ್ರ, ಸೈನ್-ಇನ್‌ನ ಎರಡನೇ ಹಂತದೊಂದಿಗೆ ಮಾಡಬಹುದು.",
    },
    "prices_nothing": {
        "en": "I read '{name}': {found} prices, and none is different from your catalogue ({missing} not in your catalogue). Nothing to change.",
        "te": "'{name}' చదివాను: {found} ధరలు, ఏదీ మీ కేటలాగ్‌కు భిన్నంగా లేదు ({missing} కేటలాగ్‌లో లేవు). మార్చడానికి ఏమీ లేదు.",
        "hi": "'{name}' पढ़ ली: {found} कीमतें, कोई भी आपके कैटलॉग से अलग नहीं है ({missing} कैटलॉग में नहीं हैं)। बदलने को कुछ नहीं है।",
        "kn": "'{name}' ಓದಿದೆ: {found} ಬೆಲೆಗಳು, ಯಾವುದೂ ನಿಮ್ಮ ಕ್ಯಾಟಲಾಗ್‌ಗಿಂತ ಬೇರೆ ಇಲ್ಲ ({missing} ಕ್ಯಾಟಲಾಗ್‌ನಲ್ಲಿ ಇಲ್ಲ). ಬದಲಿಸಲು ಏನೂ ಇಲ್ಲ.",
    },
    "enquiry_offer": {
        "en": "I read '{name}': an enquiry from {who}. Shall I add {who} to your leads and save the letter as the enquiry? Nobody is sent anything.",
        "te": "'{name}' చదివాను: {who} నుండి ఎంక్వైరీ. {who} ను మీ లీడ్స్‌లో చేర్చి, ఈ లేఖను ఎంక్వైరీగా సేవ్ చేయమంటారా? ఎవరికీ ఏమీ పంపను.",
        "hi": "'{name}' पढ़ ली: {who} की पूछताछ। क्या {who} को आपकी लीड्स में जोड़कर इस चिट्ठी को पूछताछ के रूप में सेव कर दूँ? किसी को कुछ नहीं भेजा जाएगा।",
        "kn": "'{name}' ಓದಿದೆ: {who} ಅವರಿಂದ ವಿಚಾರಣೆ. {who} ಅವರನ್ನು ನಿಮ್ಮ ಲೀಡ್‌ಗಳಿಗೆ ಸೇರಿಸಿ, ಈ ಪತ್ರವನ್ನು ವಿಚಾರಣೆಯಾಗಿ ಸೇವ್ ಮಾಡಲೇ? ಯಾರಿಗೂ ಏನೂ ಕಳುಹಿಸುವುದಿಲ್ಲ.",
    },
    "enquiry_offer_known": {
        "en": "I read '{name}': an enquiry from {who}, who is already in your leads. Shall I save the letter as their enquiry? Nobody is sent anything.",
        "te": "'{name}' చదివాను: {who} నుండి ఎంక్వైరీ, వారు ఇప్పటికే మీ లీడ్స్‌లో ఉన్నారు. ఈ లేఖను వారి ఎంక్వైరీగా సేవ్ చేయమంటారా? ఎవరికీ ఏమీ పంపను.",
        "hi": "'{name}' पढ़ ली: {who} की पूछताछ, जो पहले से आपकी लीड्स में हैं। क्या इस चिट्ठी को उनकी पूछताछ के रूप में सेव कर दूँ? किसी को कुछ नहीं भेजा जाएगा।",
        "kn": "'{name}' ಓದಿದೆ: {who} ಅವರಿಂದ ವಿಚಾರಣೆ, ಅವರು ಈಗಾಗಲೇ ನಿಮ್ಮ ಲೀಡ್‌ಗಳಲ್ಲಿ ಇದ್ದಾರೆ. ಈ ಪತ್ರವನ್ನು ಅವರ ವಿಚಾರಣೆಯಾಗಿ ಸೇವ್ ಮಾಡಲೇ? ಯಾರಿಗೂ ಏನೂ ಕಳುಹಿಸುವುದಿಲ್ಲ.",
    },
    "knowledge_offer": {
        "en": "I read '{name}'. Shall I save its text to About my business, so I can answer customers from it? Nothing is sent to anyone.",
        "te": "'{name}' చదివాను. దాని టెక్స్ట్‌ను 'నా వ్యాపారం గురించి' లో సేవ్ చేయమంటారా, కస్టమర్లకు దాని నుండి జవాబు చెప్పడానికి? ఎవరికీ ఏమీ పంపను.",
        "hi": "'{name}' पढ़ ली। क्या इसका टेक्स्ट 'मेरे कारोबार के बारे में' में सेव कर दूँ, ताकि ग्राहकों को इससे जवाब दे सकूँ? किसी को कुछ नहीं भेजा जाएगा।",
        "kn": "'{name}' ಓದಿದೆ. ಅದರ ಪಠ್ಯವನ್ನು 'ನನ್ನ ವ್ಯಾಪಾರದ ಬಗ್ಗೆ' ಯಲ್ಲಿ ಸೇವ್ ಮಾಡಲೇ, ಗ್ರಾಹಕರಿಗೆ ಅದರಿಂದ ಉತ್ತರಿಸಲು? ಯಾರಿಗೂ ಏನೂ ಕಳುಹಿಸುವುದಿಲ್ಲ.",
    },
    "clarify": {
        "en": "I read '{name}' (it looks like {looks}). What shall I do with it? I can add the people in it to your leads, save it to About my business, or tell you what is in it.",
        "te": "'{name}' చదివాను (ఇది {looks} లా ఉంది). దీనితో ఏం చేయమంటారు? అందులోని వ్యక్తులను మీ లీడ్స్‌లో చేర్చగలను, 'నా వ్యాపారం గురించి' లో సేవ్ చేయగలను, లేదా అందులో ఏముందో చెప్పగలను.",
        "hi": "'{name}' पढ़ ली (यह {looks} जैसी लगती है)। इसका क्या करूँ? इसमें के लोगों को आपकी लीड्स में जोड़ सकती हूँ, 'मेरे कारोबार के बारे में' में सेव कर सकती हूँ, या बता सकती हूँ कि इसमें क्या है।",
        "kn": "'{name}' ಓದಿದೆ (ಇದು {looks} ತರಹ ಇದೆ). ಇದನ್ನು ಏನು ಮಾಡಲಿ? ಇದರಲ್ಲಿರುವವರನ್ನು ನಿಮ್ಮ ಲೀಡ್‌ಗಳಿಗೆ ಸೇರಿಸಬಹುದು, 'ನನ್ನ ವ್ಯಾಪಾರದ ಬಗ್ಗೆ' ಯಲ್ಲಿ ಸೇವ್ ಮಾಡಬಹುದು, ಅಥವಾ ಇದರಲ್ಲಿ ಏನಿದೆ ಎಂದು ಹೇಳಬಹುದು.",
    },
    "unsure_answer": {
        "en": "I read '{name}' (it looks like {looks}), but I could not give a sure answer from it. Ask me in other words, or open the file.",
        "te": "'{name}' చదివాను (ఇది {looks} లా ఉంది), కానీ దాని నుండి ఖచ్చితమైన జవాబు ఇవ్వలేకపోయాను. వేరే మాటల్లో అడగండి, లేదా ఫైల్ తెరిచి చూడండి.",
        "hi": "'{name}' पढ़ ली (यह {looks} जैसी लगती है), पर इससे पक्का जवाब नहीं दे पाई। दूसरे शब्दों में पूछिए, या फ़ाइल खोलकर देखिए।",
        "kn": "'{name}' ಓದಿದೆ (ಇದು {looks} ತರಹ ಇದೆ), ಆದರೆ ಅದರಿಂದ ಖಚಿತ ಉತ್ತರ ಕೊಡಲಾಗಲಿಲ್ಲ. ಬೇರೆ ಮಾತುಗಳಲ್ಲಿ ಕೇಳಿ, ಅಥವಾ ಫೈಲ್ ತೆರೆದು ನೋಡಿ.",
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
    "order_needs_quote": {"en": "the order itself: an order starts from an approved quote", "te": "ఆర్డర్: ఆర్డర్ ఆమోదించిన కొటేషన్ నుండే మొదలవుతుంది", "hi": "ऑर्डर ख़ुद: ऑर्डर मंज़ूर कोटेशन से ही शुरू होता है", "kn": "ಆರ್ಡರ್: ಆರ್ಡರ್ ಅನುಮೋದಿತ ಕೊಟೇಶನ್‌ನಿಂದಲೇ ಶುರುವಾಗುತ್ತದೆ"},
    "quote_after_enquiry": {"en": "the draft quote: confirm the requirement on the enquiry's screen first", "te": "డ్రాఫ్ట్ కొటేషన్: ముందు ఎంక్వైరీ స్క్రీన్‌లో అవసరాన్ని నిర్ధారించండి", "hi": "ड्राफ़्ट कोटेशन: पहले पूछताछ की स्क्रीन पर ज़रूरत पक्की करें", "kn": "ಡ್ರಾಫ್ಟ್ ಕೊಟೇಶನ್: ಮೊದಲು ವಿಚಾರಣೆಯ ಸ್ಕ್ರೀನ್‌ನಲ್ಲಿ ಅಗತ್ಯವನ್ನು ಖಚಿತಪಡಿಸಿ"},
    "quote_from_enquiry": {"en": "making an enquiry and a quote from a letter", "te": "లేఖ నుండి ఎంక్వైరీ, కొటేషన్ తయారు చేయడం", "hi": "चिट्ठी से पूछताछ और कोटेशन बनाना", "kn": "ಪತ್ರದಿಂದ ವಿಚಾರಣೆ ಮತ್ತು ಕೊಟೇಶನ್ ಮಾಡುವುದು"},
    "order_from_file": {"en": "making an order from a file and checking the stock", "te": "ఫైల్ నుండి ఆర్డర్ చేయడం, స్టాక్ చూడడం", "hi": "फ़ाइल से ऑर्डर बनाना और स्टॉक देखना", "kn": "ಫೈಲ್‌ನಿಂದ ಆರ್ಡರ್ ಮಾಡುವುದು ಮತ್ತು ಸ್ಟಾಕ್ ನೋಡುವುದು"},
    "update_prices": {"en": "updating catalogue prices from a file", "te": "ఫైల్ నుండి కేటలాగ్ ధరలు మార్చడం", "hi": "फ़ाइल से कैटलॉग की कीमतें बदलना", "kn": "ಫೈಲ್‌ನಿಂದ ಕ್ಯಾಟಲಾಗ್ ಬೆಲೆಗಳನ್ನು ಬದಲಿಸುವುದು"},
    "too_many_prices": {"en": "changing more than 20 prices at once", "te": "ఒకేసారి 20 కంటే ఎక్కువ ధరలు మార్చడం", "hi": "एक बार में 20 से ज़्यादा कीमतें बदलना", "kn": "ಒಮ್ಮೆಗೆ 20 ಕ್ಕಿಂತ ಹೆಚ್ಚು ಬೆಲೆಗಳನ್ನು ಬದಲಿಸುವುದು"},
    "follow_up": {"en": "setting a follow-up from a file", "te": "ఫైల్ నుండి ఫాలో-అప్ పెట్టడం", "hi": "फ़ाइल से फ़ॉलो-अप लगाना", "kn": "ಫೈಲ್‌ನಿಂದ ಫಾಲೋ-ಅಪ್ ಇಡುವುದು"},
    "other": {"en": "doing that with a file", "te": "ఫైల్‌తో అది చేయడం", "hi": "फ़ाइल से वह करना", "kn": "ಫೈಲ್‌ನಿಂದ ಅದನ್ನು ಮಾಡುವುದು"},
    "too_many": {"en": "importing more than 5,000 rows at once", "te": "ఒకేసారి 5,000 వరుసలకంటే ఎక్కువ దిగుమతి చేయడం", "hi": "एक बार में 5,000 से ज़्यादा पंक्तियाँ आयात करना", "kn": "ಒಮ್ಮೆಗೆ 5,000 ಕ್ಕಿಂತ ಹೆಚ್ಚು ಸಾಲುಗಳನ್ನು ಆಮದು ಮಾಡುವುದು"},
}
TITLE = {"en": "Add {n} leads from '{name}'"}
LOOKS = {
    "lead_list": {"en": "a list of people", "te": "వ్యక్తుల జాబితా", "hi": "लोगों की सूची", "kn": "ಜನರ ಪಟ್ಟಿ"},
    "visiting_card": {"en": "a visiting card", "te": "విజిటింగ్ కార్డు", "hi": "विज़िटिंग कार्ड", "kn": "ವಿಸಿಟಿಂಗ್ ಕಾರ್ಡ್"},
    "price_list": {"en": "a price list", "te": "ధరల జాబితా", "hi": "कीमतों की सूची", "kn": "ಬೆಲೆ ಪಟ್ಟಿ"},
    "enquiry": {"en": "an enquiry", "te": "ఎంక్వైరీ", "hi": "पूछताछ", "kn": "ವಿಚಾರಣೆ"},
    "order": {"en": "an order", "te": "ఆర్డర్", "hi": "ऑर्डर", "kn": "ಆರ್ಡರ್"},
    "brochure": {"en": "a brochure or a document", "te": "బ్రోచర్ లేదా డాక్యుమెంట్", "hi": "ब्रोशर या दस्तावेज़", "kn": "ಬ್ರೋಷರ್ ಅಥವಾ ದಾಖಲೆ"},
    "other": {"en": "a document", "te": "డాక్యుమెంట్", "hi": "दस्तावेज़", "kn": "ದಾಖಲೆ"},
}
SCREEN_OF = {"quote_from_enquiry": {"label": "Enquiries", "href": "/enquiries"}, "order_from_file": {"label": "Orders", "href": "/orders"},
             "update_prices": {"label": "Catalogue", "href": "/catalogue"}, "follow_up": {"label": "Follow-ups", "href": "/followups"}, "other": None}
KNOWLEDGE_TOOL = "knowledge.add_source"
LOOKUP_TOOL = "contacts.contact_by_phone"
ENQUIRY_TOOL = "leads.capture_enquiry"
CATALOGUE_LIST_TOOL = "catalogue.list_items"
PRICE_TOOL = "catalogue.put_item"
MAX_KNOWLEDGE_CHARS = 60_000
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
    """The `file_preview` card of a stored plan (a replay and the stored chat show it in its state now; the file's rows only while the file is there, at the turn), or a `plan` card for a plan that
    adds no people (saving a brochure to About my business)."""
    card = plan.get("card") or {}
    if card.get("kind") == "plan":
        return {"kind": "plan", "id": str(uuid.uuid5(_NS, str(plan["plan_id"]))), "plan": public_plan(plan)}
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
        sheet_b64 = _csv_b64(grid)
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

    # ---- a request about the file (job A2b): understand it by code, plan with the model, show the card
    def with_request(self, token: str, tenant_id: uuid.UUID, file_id: uuid.UUID, request: str, *, plan_with: Callable[[Understanding, str, Language], Planned], message_id: uuid.UUID,
                     conversation_id: uuid.UUID | None, language: Language) -> tuple[str, dict[str, Any] | None]:
        """`plan_with` is the planner (app/assistant_work/planner.plan, bound to the turn). A school's file never comes here (the turn decides)."""
        try:
            f = self.store.file_get(token, tenant_id, file_id)
        except Exception:
            return words("gone", language), None
        name, kind = str(f.get("name") or "file"), str(f.get("kind") or "")
        data_base64 = str(f.get("data_base64") or "")
        try:
            u = self._understand(name, kind, data_base64)
        except extract.ReadRefused as exc:
            return self._refused(exc.code, name, language)
        except ApiError as exc:
            logger.info("assistant file not read by the AI model: %s", exc.code)
            return words("ai_limit" if exc.code in AI_ALLOWANCE_CODES else "no_reader", language, name=name), cant_do("not_yet", what("scanned", language), {"label": "Lead Desk", "href": "/leads/import"})
        if u is None:
            return words("unreadable", language, name=name), None
        looks = LOOKS[u.kind].get(language, LOOKS[u.kind]["en"])
        try:
            planned = plan_with(u, request, language)
        except ApiError as exc:   # the model: the deterministic path still works for a list of people
            logger.info("assistant file plan not made: %s", exc.code)
            if u.kind in ("lead_list", "visiting_card"):
                return self.answer(token, tenant_id, file_id, message_id=message_id, conversation_id=conversation_id, language=language)
            return words("ai_limit" if exc.code in AI_ALLOWANCE_CODES else "no_reader", language, name=name), None
        if planned.decision == "answer":
            return (planned.answer or words("unsure_answer", language, name=name, looks=looks)), None
        if planned.decision == "clarify":
            return (planned.question or words("clarify", language, name=name, looks=looks)), None
        if planned.decision == "cant_do":
            w = what(planned.cant, language)
            return words("cant", language, name=name, what=w), cant_do("not_yet", w, SCREEN_OF.get(planned.cant))
        sentence, card = self._do(token, tenant_id, file_id, name, kind, data_base64, u, planned, message_id=message_id, conversation_id=conversation_id, language=language)
        if planned.cant:
            acting = {a["action"] for a in planned.actions}
            part = ("quote_after_enquiry" if planned.cant == "quote_from_enquiry" and "capture_enquiry" in acting
                    else "order_needs_quote" if planned.cant == "order_from_file" and "check_stock" in acting else planned.cant)
            sentence += words("cant_part", language, what=what(part, language))
        return sentence, card

    def _do(self, token: str, tenant_id: uuid.UUID, file_id: uuid.UUID, name: str, kind: str, data_base64: str, u: Understanding, planned: Planned, *, message_id: uuid.UUID,
            conversation_id: uuid.UUID | None, language: Language) -> tuple[str, dict[str, Any] | None]:
        names = [a["action"] for a in planned.actions]
        plan_id = uuid.uuid4()
        stock = self._stock(token, tenant_id, name, u, message_id=message_id, language=language) if "check_stock" in names else ""
        if "capture_enquiry" in names:
            sentence, card = self._enquiry(token, tenant_id, file_id, name, u, plan_id, message_id=message_id, conversation_id=conversation_id, language=language)
            return (f"{stock}\n\n{sentence}" if stock else sentence), card
        if "check_stock" in names:
            return stock, None
        if "update_prices" in names:
            return self._prices(token, tenant_id, file_id, name, kind, u, plan_id, message_id=message_id, conversation_id=conversation_id, language=language)
        knowledge = [self._knowledge_step(token, tenant_id, plan_id, u, next((a["title"] for a in planned.actions if a["action"] == "add_to_knowledge"), ""))] if "add_to_knowledge" in names else []
        if "add_people" in names:
            if kind in READ_KIND_OF:
                return self._lead_list(token, tenant_id, file_id, name, kind, data_base64, message_id=message_id, conversation_id=conversation_id, language=language, extra_steps=knowledge)
            sheet_b64 = _csv_b64(_headed(u.people) if u.people else [])
            derived = self.store.file_put(token, tenant_id, (name.rsplit(".", 1)[0] or "file")[:190] + ".csv", "text/csv", "sheet", sheet_b64)
            self._drop_quietly(token, tenant_id, file_id)
            return self._lead_list(token, tenant_id, uuid.UUID(str(derived["file_id"])), name, "sheet", sheet_b64, message_id=message_id, conversation_id=conversation_id, language=language,
                                   read_by=u.read_by, extra_steps=knowledge)
        step = {k: v for k, v in knowledge[0].items() if k != "plan_id"}
        plan = self.store.plan_put(token, tenant_id, {
            "plan_id": str(plan_id), "message_id": str(message_id), "conversation_id": str(conversation_id) if conversation_id else None, "file_id": step["call"]["file_id"],
            "title": f"Save '{name}' to About my business"[:200], "file_name": name, "card": {"kind": "plan", "destination": "knowledge", "read_by": u.read_by}, "steps": [step],
        })
        if kind not in READ_KIND_OF:
            self._drop_quietly(token, tenant_id, file_id)
        picture = words("from_picture", language) if u.read_by in ("local_ocr", "ai") else ""
        return words("knowledge_offer", language, name=name) + picture, card_of_plan(plan)

    def _prices(self, token: str, tenant_id: uuid.UUID, file_id: uuid.UUID, name: str, kind: str, u: Understanding, plan_id: uuid.UUID, *, message_id: uuid.UUID,
                conversation_id: uuid.UUID | None, language: Language) -> tuple[str, dict[str, Any] | None]:
        """The file's prices against the catalogue, old -> new, as a MONEY plan (the Owner's, with the second factor and the card's second tap). Undo: each item put back as it was."""
        from app.assistant_work import prices as pr

        screen = {"label": "Catalogue", "href": "/catalogue"}
        rows = pr.price_rows(u)
        items = self._catalogue_items(token, tenant_id, message_id)
        if items is None:
            return words("cant", language, name=name, what=what("update_prices", language)), cant_do("not_yet", what("update_prices", language), screen)
        changes, unchanged, missing = pr.match(rows, items)
        facts = [{"code": "found", "n": len(rows)}, {"code": "changed", "n": len(changes)}, *([{"code": "unchanged", "n": unchanged}] if unchanged else []),
                 *([{"code": "not_in_catalogue", "n": missing}] if missing else [])]
        sample = [[c.item.get("name") or "", pr.rupees(c.old), pr.rupees(c.new)] for c in changes[:5]]
        if kind not in READ_KIND_OF:
            self._drop_quietly(token, tenant_id, file_id)
        if not changes:
            return words("prices_nothing", language, name=name, found=len(rows), missing=missing), {
                "kind": "file_preview", "id": str(uuid.uuid4()), "file_name": name, "destination": "catalogue", "customer_name": None, "read_by": u.read_by, "facts": facts,
                "columns": ["Item", "Now", "New"], "rows": [], "plan": None}
        if len(changes) > pr.MAX_CHANGES:
            return words("cant", language, name=name, what=what("too_many_prices", language)), cant_do("not_yet", what("too_many_prices", language), screen)
        steps = [{"tool": PRICE_TOOL, "summary": f"{str(c.item.get('name') or '')[:120]}: {pr.rupees(c.old)} → {pr.rupees(c.new)}", "undoable": True, "status": "proposed", "error": None,
                  "call": {"path": {"item_id": str(c.item["id"])}, "body": pr.put_body(c.item, c.new)}} for c in changes]
        plan = self.store.plan_put(token, tenant_id, {
            "plan_id": str(plan_id), "message_id": str(message_id), "conversation_id": str(conversation_id) if conversation_id else None, "file_id": str(file_id) if kind in READ_KIND_OF else None,
            "title": f"Change {len(changes)} catalogue price{'s' if len(changes) != 1 else ''} from '{name}'"[:200], "file_name": name,
            "sensitive": "money", "owner_only": True, "needs_second_factor": True,
            "card": {"destination": "catalogue", "read_by": u.read_by, "facts": facts, "columns": ["Item", "Now", "New"]}, "steps": steps,
        })
        picture = words("from_picture", language) if u.read_by in ("local_ocr", "ai") else ""
        return words("prices_offer", language, name=name, found=len(rows), changed=len(changes), unchanged=unchanged, missing=missing) + picture, card_of_plan(plan, sample)

    def _enquiry(self, token: str, tenant_id: uuid.UUID, file_id: uuid.UUID, name: str, u: Understanding, plan_id: uuid.UUID, *, message_id: uuid.UUID, conversation_id: uuid.UUID | None,
                 language: Language) -> tuple[str, dict[str, Any] | None]:
        """An enquiry letter: its sender through the lead import (added if new, merged if known; Undo), then found by the number in the letter, then the letter saved as their enquiry (the
        enquiry route scrubs numbers and addresses from the text before storing it). The number is read from the kept CSV at run time and the letter from the kept text: neither sits in the plan."""
        who = (u.people[1][0] or u.people[1][2])[:80]
        sheet_b64 = _csv_b64(u.people[:2])
        sheet = self.store.file_put(token, tenant_id, (name.rsplit(".", 1)[0] or "file")[:190] + ".csv", "text/csv", "sheet", sheet_b64)
        letter = self.store.file_put(token, tenant_id, (name.rsplit(".", 1)[0] or "file")[:190] + ".txt", "text/plain", "text", base64.b64encode(u.text[:200_000].encode("utf-8")).decode("ascii"))
        self._drop_quietly(token, tenant_id, file_id)
        sheet_id, letter_id = str(sheet["file_id"]), str(letter["file_id"])
        enquiry_id = str(uuid.uuid5(_NS, f"enquiry:{plan_id}"))   # idempotent: a retried run replays the same enquiry

        def steps(before: int) -> list[dict[str, Any]]:
            lookup_no = before + 1
            return [
                {"tool": LOOKUP_TOOL, "summary": f"Find {who} by the number in the letter"[:300], "undoable": False, "status": "proposed", "error": None,
                 "call": {"path": {}, "query": {"phone": {"$cell": [1, 2]}}, "cells_from": sheet_id}},
                {"tool": ENQUIRY_TOOL, "summary": f"Save '{name}' as {who}'s enquiry (numbers and addresses are removed from the stored text)"[:300], "undoable": False, "status": "proposed",
                 "error": None, "call": {"path": {"lead_id": {"$ref": [lookup_no, "lead_ids", 0]}}, "body": {"id": enquiry_id, "channel": "other", "received_at": now_utc().isoformat(),
                                                                                                         "subject": f"From the file '{name}'"[:200]},
                                         "file": "text", "file_id": letter_id, "file_field": "text"}},
            ]

        more = More(plan_id, f"Save the enquiry from {who} ('{name}')", "leads", steps,
                    lambda with_import: words("enquiry_offer" if with_import else "enquiry_offer_known", language, name=name, who=who))
        return self._lead_list(token, tenant_id, uuid.UUID(sheet_id), name, "sheet", sheet_b64, message_id=message_id, conversation_id=conversation_id, language=language, read_by=u.read_by,
                               more=more)

    def _stock(self, token: str, tenant_id: uuid.UUID, name: str, u: Understanding, *, message_id: uuid.UUID, language: Language) -> str:
        """Read-only: the order's lines against the catalogue's stock words (app/assistant_work/stock.py)."""
        from app.assistant_work import stock as st

        items = self._catalogue_items(token, tenant_id, message_id)
        if items is None:
            return words("cant", language, name=name, what=what("order_from_file", language))
        answer, short = st.check(st.order_lines(u), items, name, language)
        logger.info("assistant file stock check: lines=%d short=%d", len(st.order_lines(u)), short)
        return answer

    def _catalogue_items(self, token: str, tenant_id: uuid.UUID, message_id: uuid.UUID) -> list[dict[str, Any]] | None:
        """Every catalogue item (the screen's own list route, page by page; at most 1,000), or None when the workspace has no catalogue or the list cannot be read."""
        items: list[dict[str, Any]] = []
        after: str | None = None
        for _ in range(20):
            query = {"include_inactive": "true", "limit": "50", **({"after": after} if after else {})}
            got = asyncio.run(self.tools.run(tenant_id, token, executor.Call(tool=CATALOGUE_LIST_TOOL, query=query), message_id))
            if not got.ok or not isinstance(got.answer, dict):
                return None
            items.extend(i for i in got.answer.get("items") or [] if isinstance(i, dict))
            after = got.answer.get("next_cursor")
            if not after:
                break
        return items

    def _understand(self, name: str, kind: str, data_base64: str) -> Understanding | None:
        """The file, understood by code (no model, except the extraction step's AI reader of page images, under the owner's rules)."""
        if kind in ("pdf", "image", "doc"):
            read = self.reader.read(kind, base64.b64decode(data_base64), school=self._is_school, vision=self.vision)
            return understand(name, READ_BY[read.how], read.text, read.grids)
        if kind == "text":
            return understand(name, "file", _text_of(data_base64), [])
        if self.lead_sources is None or kind not in READ_KIND_OF:
            return None
        from types import SimpleNamespace

        try:
            loaded = self.lead_sources.load(SimpleNamespace(kind=READ_KIND_OF[kind], content_base64=data_base64, text=None, sheet_url=None))
        except Exception:
            return None
        if loaded.grid is not None:
            table = [list(loaded.grid.header), *[list(r) for r in loaded.grid.rows]]
            return understand(name, "file", "\n".join(" | ".join(r) for r in table[:200]), [table])
        people = [["Name", "Company", "Phone", "Email"], *[[str(r.get("name") or ""), "", str(r.get("phone") or ""), str(r.get("email") or "")] for r in loaded.rows or []]]
        return understand(name, "file", "\n".join(" | ".join(r) for r in people[:200]), [], people)

    def _knowledge_step(self, token: str, tenant_id: uuid.UUID, plan_id: uuid.UUID, u: Understanding, title: str) -> dict[str, Any]:
        """Saving the file's text to About my business (the knowledge sources' own route; the text waits as a small file under the 24 h rule and is read again only by "Do it")."""
        text = u.text[:MAX_KNOWLEDGE_CHARS]
        derived = self.store.file_put(token, tenant_id, (u.file_name.rsplit(".", 1)[0] or "file")[:190] + ".txt", "text/plain", "text", base64.b64encode(text.encode("utf-8")).decode("ascii"))
        source_id = str(uuid.uuid5(_NS, f"knowledge:{plan_id}"))   # idempotent: a retried run replays the same source
        return {"plan_id": str(plan_id), "tool": KNOWLEDGE_TOOL, "summary": f"Save the text of '{u.file_name}' to About my business ({len(text):,} characters)"[:300], "undoable": True,
                "status": "proposed", "error": None,
                "call": {"path": {}, "body": {"source_id": source_id, "kind": "paste", "title": (title or u.file_name)[:120]}, "file": "text", "file_id": str(derived["file_id"])}}

    def _drop_quietly(self, token: str, tenant_id: uuid.UUID, file_id: uuid.UUID) -> None:
        try:
            self.store.file_drop(token, tenant_id, file_id)
        except Exception as exc:   # the sweep deletes it at the latest after a day
            logger.warning("assistant file not deleted after reading: %s", exc.__class__.__name__)

    # ---- a list of people (a sheet, a vCard, a text list, or what was read from a document): the lead import's own read and preview
    def _lead_list(self, token: str, tenant_id: uuid.UUID, file_id: uuid.UUID, name: str, kind: str, data_base64: str, *, message_id: uuid.UUID, conversation_id: uuid.UUID | None,
                   language: Language, read_by: str = "file", extra_steps: list[dict[str, Any]] | None = None, more: More | None = None) -> tuple[str, dict[str, Any] | None]:
        """`extra_steps` follow the import (About my business); `more` is a plan that goes on after the import, or alone when everybody is already a lead (an enquiry's lookup and capture)."""
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
        if new == 0 and more is not None and found > 0:   # the sender is already a lead: only the rest of the plan
            plan = self.store.plan_put(token, tenant_id, {
                "plan_id": str(more.plan_id), "message_id": str(message_id), "conversation_id": str(conversation_id) if conversation_id else None, "file_id": str(file_id),
                "title": more.title[:200], "file_name": name, "card": {"kind": "plan", "destination": more.destination, "read_by": read_by}, "steps": more.steps(0),
            })
            return more.sentence(False) + picture, card_of_plan(plan)
        if new == 0:
            sentence = words("nobody", language, name=name) if found == 0 else words("nothing_new", language, name=name, found=found)
            return sentence, {"kind": "file_preview", "id": str(uuid.uuid4()), "file_name": name, "destination": "leads", "customer_name": None, "read_by": read_by, "facts": facts, "columns": columns,
                              "rows": rows, "plan": None}
        plan_id = more.plan_id if more is not None else (uuid.UUID(str(extra_steps[0]["plan_id"])) if extra_steps else uuid.uuid4())
        step_body = {k: v for k, v in preview_body.items() if k not in ("content_base64", "text")}
        step_body["import_id"] = str(uuid.uuid5(_NS, f"import:{plan_id}"))   # idempotent: a retried run replays the same import
        plan = self.store.plan_put(token, tenant_id, {
            "plan_id": str(plan_id), "message_id": str(message_id), "conversation_id": str(conversation_id) if conversation_id else None, "file_id": str(file_id),
            "title": (more.title if more is not None else TITLE["en"].format(n=new, name=name) + (" and save it to About my business" if extra_steps else ""))[:200], "file_name": name,
            "card": {"destination": "leads", "read_by": read_by, "facts": facts, "columns": columns[:40]},
            "steps": [{"tool": IMPORT_TOOL, "summary": STEP["en"].format(n=new, existing=existing), "undoable": True, "status": "proposed", "error": None,
                       "call": {"path": {}, "body": step_body, "file": kind}},
                      *[{k: v for k, v in x.items() if k != "plan_id"} for x in extra_steps or []], *(more.steps(1) if more is not None else [])],
        })
        if more is not None:
            return more.sentence(True) + picture, card_of_plan(plan, rows)
        also = words("also_knowledge", language) if extra_steps else ""
        return words("offer", language, name=name, found=found, existing=existing, new=new) + also + picture, card_of_plan(plan, rows)

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


@dataclass(frozen=True)
class More:
    """The rest of a plan after the import of its people: `steps(n)` with n = how many steps come before (a `$ref` names its step by number); `sentence(with_import)`."""

    plan_id: uuid.UUID
    title: str
    destination: str
    steps: Callable[[int], list[dict[str, Any]]]
    sentence: Callable[[bool], str]


def _resolved(values: dict[str, Any], answers: dict[int, Any], cells: list[list[str]] | None = None) -> dict[str, str]:
    """A step's path or query, with each `{"$ref": [step_no, key, index, ...]}` replaced by that value of an earlier step's answer, and each `{"$cell": [row, column]}` by that cell of the step's
    kept CSV (LookupError when it is not there)."""
    out: dict[str, str] = {}
    for name, value in values.items():
        if isinstance(value, dict) and isinstance(value.get("$cell"), list) and len(value["$cell"]) == 2:
            row, col = (int(x) for x in value["$cell"])
            if not cells or row >= len(cells) or col >= len(cells[row]) or not cells[row][col].strip():
                raise LookupError(name)
            out[name] = cells[row][col].strip()
        elif isinstance(value, dict) and isinstance(value.get("$ref"), list) and value["$ref"]:
            ref = value["$ref"]
            got: Any = answers[int(ref[0])]
            for key in ref[1:]:
                if isinstance(got, dict) and isinstance(key, str):
                    got = got[key]
                elif isinstance(got, list) and isinstance(key, int):
                    got = got[key]
                else:
                    raise LookupError(name)
            if got is None or isinstance(got, (dict, list)):
                raise LookupError(name)
            out[name] = str(got)
        else:
            out[name] = str(value)
    return out


def _csv_b64(grid: extract.Grid) -> str:
    out = io.StringIO()
    csv.writer(out).writerows(grid[: MAX_ROWS + 1])
    return base64.b64encode(out.getvalue().encode("utf-8")).decode("ascii")


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

    def _drop_all(self, token: str, tenant_id: uuid.UUID, plan: dict[str, Any]) -> None:
        ids = {str(plan.get("file_id") or "")} | {str((s.get("call") or {}).get("file_id") or "") for s in plan.get("steps") or []}
        for file_id in sorted(i for i in ids if i):
            self._drop(token, tenant_id, file_id)

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
            self._drop_all(token, tenant_id, plan)
            return moved
        if plan.get("owner_only") and not is_owner:
            raise ApiError(403, "forbidden", "Only the Owner can do this.")
        if plan.get("sensitive") and not confirmed:
            raise ApiError(409, "confirm_needed", "Confirm this on the card first.")
        self._move(token, tenant_id, plan_id, "proposed", "running")
        steps = [dict(s) for s in plan.get("steps") or []]
        message_id = uuid.UUID(str(plan["message_id"]))
        files_read: dict[str, dict[str, Any]] = {}
        answers: dict[int, Any] = {}   # each step's answer, for a later step that names it ({"$ref": [step, key, ...]})
        failed = False
        for no, step in enumerate(steps, start=1):
            if failed:
                step["status"] = "skipped"
                continue
            call_spec = step.get("call") or {}
            body = dict(call_spec.get("body") or {}) if isinstance(call_spec.get("body"), dict) else None
            if call_spec.get("file") and body is not None:
                step_file = call_spec.get("file_id") or plan.get("file_id")   # a plan of several steps may read a different file per step (the people as a CSV, the text for About my business)
                if str(step_file) not in files_read:
                    try:
                        files_read[str(step_file)] = self.store.file_get(token, tenant_id, uuid.UUID(str(step_file)))
                    except Exception:
                        files_read[str(step_file)] = {}
                data = files_read[str(step_file)]
                raw = str(data.get("data_base64") or "")
                if not raw:
                    step["status"], step["error"], failed = "failed", "not_found", True
                    self._log(token, tenant_id, plan_id, no, step, None, {})
                    continue
                if call_spec.get("file_field"):   # the step's text field is the kept file's text (an enquiry's letter): it never sits in the plan itself
                    body[str(call_spec["file_field"])] = _text_of(raw)
                elif body.get("kind") == "paste":
                    body["text"] = _text_of(raw)
                else:
                    body["content_base64"] = raw
            cells: list[list[str]] = []
            if call_spec.get("cells_from"):   # a value read from the kept CSV at run time (a phone number never sits in the plan itself)
                cells_file = str(call_spec["cells_from"])
                if cells_file not in files_read:
                    try:
                        files_read[cells_file] = self.store.file_get(token, tenant_id, uuid.UUID(cells_file))
                    except Exception:
                        files_read[cells_file] = {}
                cells = list(csv.reader(io.StringIO(_text_of(str(files_read[cells_file].get("data_base64") or "")))))
            try:
                path = _resolved(dict(call_spec.get("path") or {}), answers, cells)
                query = _resolved(dict(call_spec.get("query") or {}), answers, cells)
            except LookupError:   # a value from an earlier step that is not there (nobody found by that number)
                step["status"], step["error"], failed = "failed", "not_found", True
                self._log(token, tenant_id, plan_id, no, step, None, {})
                continue
            call = executor.Call(tool=str(step.get("tool")), path=path, query=query, body=body)
            try:
                result = await self.tools.run(tenant_id, token, call, message_id)
            except executor.ToolRefused:
                step["status"], step["error"], failed = "failed", "invalid", True
                self._log(token, tenant_id, plan_id, no, step, None, {})
                continue
            answers[no] = result.answer
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
        self._drop_all(token, tenant_id, plan)
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
