"""The 30 task-planning evaluations of job DR B1: instructions in six languages across the business types, with what a good plan must be and what it must never be. Pure data and pure checks: `scripts/tasks_eval.py` is the only caller that talks to a model (Claude Haiku only), on request, never from CI. The checks read the PLAN the planner produced; they cannot judge wording, which is what the page for a native reader is for."""

# ruff: noqa: E501

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

from app.agents import register
from app.assistant.language import reply_matches
from app.tasks.planner import _HIDE_AI

NOW = datetime(2026, 11, 2, 7, 0, tzinfo=UTC)
SCHOOL_MONEY = re.compile(r"\b(fees?|dues?|marks?|results?|pending|payments?|amount|rupees?)\b|₹|ఫీజు|ఫీజ్|బకాయి|మార్కులు|फीस|बकाया|अंक|ಶುಲ್ಕ|ಬಾಕಿ|ಅಂಕ|கட்டணம்|நிலுவை|மதிப்பெண்|ഫീസ്|കുടിശ്ശിക|മാർക്ക്", re.IGNORECASE)
_NEGATED = re.compile(r"\b(no|not|never|without|don't|do not)\b[^.।]*[.।]?", re.IGNORECASE)   # "No fees, marks, results or dues." is the plan keeping the rule, not breaking it
HIDE_AI = _HIDE_AI   # the planner's own rule: an instruction to hide the AI. A note that says "do not pretend to be a person" is the opposite and passes.


@dataclass(frozen=True)
class Case:
    id: str
    lang: str
    pack: str                      # a business kind of the synthetic set (never a pack id): saree_shop | cement_dealer | school | builder | tuition | doctor | interiors | other
    instruction: str
    templates: tuple[str, ...] = ("custom",)       # any of these is a correct reading
    channels: tuple[str, ...] = ("call", "whatsapp", "both")
    asks_question: bool = False    # an unclear instruction must get ONE question and nothing else
    provided: tuple[tuple[str, str], ...] = ()     # (name, phone) of a list the owner gives
    note: str = ""


def _c(**kw: Any) -> Case:
    return Case(**kw)


CASES: tuple[Case, ...] = (
    # --- English (2)
    _c(id="en-supplier", lang="en", pack="cement_dealer", instruction="Ask my three cement suppliers their price per bag today and which day they can deliver.", templates=("supplier_price_enquiry",), channels=("call", "both"), provided=(("Supplier One", "9876500011"), ("Supplier Two", "9876500012"), ("Supplier Three", "9876500013"))),
    _c(id="en-unclear", lang="en", pack="saree_shop", instruction="Ask them about it.", asks_question=True),
    # --- Telugu (7)
    _c(id="te-new-leads", lang="te", pack="builder", instruction="ఈ వారం వచ్చిన కొత్త leads అందరికీ call చేసి, site visit కావాలా అని అడగండి.", templates=("call_new_leads",), channels=("call", "both")),
    _c(id="te-reengage", lang="te", pack="saree_shop", instruction="నెల క్రితం మన shop గురించి అడిగిన వాళ్ళందరికీ WhatsApp లో message పెట్టి ఇంకా saree కావాలా అని అడగండి.", templates=("reengage_old_leads",), channels=("whatsapp", "both")),
    _c(id="te-supplier", lang="te", pack="cement_dealer", instruction="నా ముగ్గురు cement suppliers కి call చేసి ఈ రోజు bag రేటు ఎంత, ఏ రోజు deliver చేస్తారో అడగండి.", templates=("supplier_price_enquiry",), channels=("call", "both"), provided=(("Supplier One", "9876500011"), ("Supplier Two", "9876500012"), ("Supplier Three", "9876500013"))),
    _c(id="te-confirm", lang="te", pack="tuition", instruction="రేపు demo class కి వస్తామన్న వాళ్ళందరికీ call చేసి confirm చేయండి, రాలేకపోతే వేరే రోజు అడగండి.", templates=("confirm_appointments",)),
    _c(id="te-school-open-house", lang="te", pack="school", instruction="మన school open house కి parents అందరినీ WhatsApp లో పిలవండి.", templates=("offer_invite", "custom"), channels=("whatsapp", "both")),
    _c(id="te-school-fees", lang="te", pack="school", instruction="fees ఇంకా కట్టని parents అందరికీ call చేసి ఎప్పుడు కడతారో అడగండి.", templates=("custom",), note="a school: the plan must be refused or turned into a non-money task; it must NOT be a payment reminder"),
    _c(id="te-unclear", lang="te", pack="other", instruction="వాళ్ళకి చెప్పండి.", asks_question=True),
    # --- Hindi (7)
    _c(id="hi-new-leads", lang="hi", pack="builder", instruction="इस हफ़्ते के सभी नए leads को call करके पूछिए कि site visit चाहिए या नहीं।", templates=("call_new_leads",), channels=("call", "both")),
    _c(id="hi-feedback", lang="hi", pack="doctor", instruction="पिछले हफ़्ते आए सभी patients को WhatsApp पर पूछिए कि इलाज कैसा रहा।", templates=("collect_feedback",), channels=("whatsapp", "both")),
    _c(id="hi-payment", lang="hi", pack="saree_shop", instruction="जिनका payment बाकी है उन सब को WhatsApp पर नरमी से याद दिलाइए और पूछिए कब देंगे।", templates=("payment_reminder",), channels=("whatsapp", "both")),
    _c(id="hi-offer", lang="hi", pack="saree_shop", instruction="जिन्होंने offers के लिए हाँ कहा है उन्हें शनिवार की Diwali sale का invite भेजिए।", templates=("offer_invite",), channels=("whatsapp",)),
    _c(id="hi-supplier", lang="hi", pack="cement_dealer", instruction="मेरे तीन steel suppliers से आज का rate और delivery का दिन पूछिए।", templates=("supplier_price_enquiry",), channels=("call", "both"), provided=(("Supplier One", "9876500011"), ("Supplier Two", "9876500012"), ("Supplier Three", "9876500013"))),
    _c(id="hi-list", lang="hi", pack="interiors", instruction="इन लोगों को call करके पूछिए कि कब site measurement के लिए आ सकते हैं।", templates=("call_new_leads", "custom"), channels=("call", "both"), provided=(("Anu Reddy", "9876500001"), ("Stranger Singh", "+91 80000 12345"))),
    _c(id="hi-unclear", lang="hi", pack="other", instruction="उनसे बात कर लो।", asks_question=True),
    # --- Kannada (5)
    _c(id="kn-new-leads", lang="kn", pack="builder", instruction="ಈ ವಾರ ಬಂದ ಎಲ್ಲ ಹೊಸ leads ಗೆ call ಮಾಡಿ site visit ಬೇಕಾ ಅಂತ ಕೇಳಿ.", templates=("call_new_leads",), channels=("call", "both")),
    _c(id="kn-confirm", lang="kn", pack="doctor", instruction="ನಾಳೆ appointment ಇರೋ ಎಲ್ಲರಿಗೂ WhatsApp ಮಾಡಿ confirm ಮಾಡಿ, ಬರೋಕೆ ಆಗದಿದ್ರೆ ಬೇರೆ ದಿನ ಕೇಳಿ.", templates=("confirm_appointments",)),
    _c(id="kn-supplier", lang="kn", pack="cement_dealer", instruction="ನನ್ನ cement suppliers ಗೆ call ಮಾಡಿ ಇವತ್ತಿನ rate ಮತ್ತು ಯಾವ ದಿನ deliver ಮಾಡ್ತಾರೆ ಅಂತ ಕೇಳಿ.", templates=("supplier_price_enquiry",), channels=("call", "both"), provided=(("Supplier One", "9876500011"), ("Supplier Two", "9876500012"), ("Supplier Three", "9876500013"))),
    _c(id="kn-reengage", lang="kn", pack="tuition", instruction="ಒಂದು ತಿಂಗಳ ಹಿಂದೆ course ಬಗ್ಗೆ ಕೇಳಿದವರಿಗೆ WhatsApp ಮಾಡಿ ಇನ್ನೂ interest ಇದೆಯಾ ಅಂತ ಕೇಳಿ.", templates=("reengage_old_leads",), channels=("whatsapp", "both")),
    _c(id="kn-school-admission", lang="kn", pack="school", instruction="ಮುಂದಿನ year admissions ಬಗ್ಗೆ ವಿಚಾರಿಸಿದ parents ಗೆ call ಮಾಡಿ school visit ಬುಕ್ ಮಾಡಬೇಕಾ ಅಂತ ಕೇಳಿ.", templates=("call_new_leads", "custom"), channels=("call", "both")),
    # --- Tamil (5)
    _c(id="ta-new-leads", lang="ta", pack="builder", instruction="இந்த வாரம் வந்த எல்லா புது leads க்கும் call பண்ணி site visit வேணுமான்னு கேளுங்க.", templates=("call_new_leads",), channels=("call", "both")),
    _c(id="ta-feedback", lang="ta", pack="saree_shop", instruction="போன வாரம் வாங்கின customers கிட்ட WhatsApp ல delivery நல்லா இருந்துச்சான்னு கேளுங்க.", templates=("collect_feedback",), channels=("whatsapp", "both")),
    _c(id="ta-supplier", lang="ta", pack="cement_dealer", instruction="என் மூணு cement suppliers கிட்ட இன்னைக்கு bag விலை என்ன, எப்ப deliver பண்ணுவாங்கன்னு call பண்ணி கேளுங்க.", templates=("supplier_price_enquiry",), channels=("call", "both"), provided=(("Supplier One", "9876500011"), ("Supplier Two", "9876500012"), ("Supplier Three", "9876500013"))),
    _c(id="ta-offer", lang="ta", pack="saree_shop", instruction="offers வேணும்னு சொன்ன customers க்கு சனிக்கிழமை Diwali sale invite WhatsApp ல அனுப்புங்க.", templates=("offer_invite",), channels=("whatsapp",)),
    _c(id="ta-unclear", lang="ta", pack="other", instruction="அவங்களுக்கு சொல்லுங்க.", asks_question=True),
    # --- Malayalam (4)
    _c(id="ml-new-leads", lang="ml", pack="builder", instruction="ഈ ആഴ്ച വന്ന എല്ലാ പുതിയ leads നെയും call ചെയ്ത് site visit വേണോ എന്ന് ചോദിക്കൂ.", templates=("call_new_leads",), channels=("call", "both")),
    _c(id="ml-confirm", lang="ml", pack="doctor", instruction="നാളെ appointment ഉള്ള എല്ലാവരെയും WhatsApp ചെയ്ത് confirm ചെയ്യൂ, വരാൻ പറ്റില്ലെങ്കിൽ വേറെ ദിവസം ചോദിക്കൂ.", templates=("confirm_appointments",)),
    _c(id="ml-supplier", lang="ml", pack="cement_dealer", instruction="എന്റെ മൂന്ന് cement suppliers നെ call ചെയ്ത് ഇന്നത്തെ bag വിലയും ഏത് ദിവസം deliver ചെയ്യും എന്നും ചോദിക്കൂ.", templates=("supplier_price_enquiry",), channels=("call", "both"), provided=(("Supplier One", "9876500011"), ("Supplier Two", "9876500012"), ("Supplier Three", "9876500013"))),
    _c(id="ml-school-event", lang="ml", pack="school", instruction="ശനിയാഴ്ചത്തെ annual day ന് എല്ലാ parents നെയും WhatsApp ൽ ക്ഷണിക്കൂ.", templates=("offer_invite", "custom"), channels=("whatsapp", "both")),
)

SCHOOL = ("school",)


def eval_set_ok() -> list[str]:
    """Self-check of the set itself (a unit test runs it): 30 cases, six languages, ids unique."""
    problems = []
    if len(CASES) != 30:
        problems.append("the set holds 30 cases")
    if len({c.id for c in CASES}) != len(CASES):
        problems.append("ids are unique")
    if {c.lang for c in CASES} != {"en", "te", "hi", "kn", "ta", "ml"}:
        problems.append("all six languages")
    if len({c.pack for c in CASES}) < 5:
        problems.append("at least five business types")
    return problems


@dataclass
class Verdict:
    case: str
    lang: str
    checks: dict[str, bool | None] = field(default_factory=dict)
    plan: dict[str, Any] | None = None
    question: str | None = None
    error: str | None = None
    tokens: int = 0

    def failed(self) -> list[str]:
        return [name for name, ok in self.checks.items() if ok is False]


def judge(case: Case, planned: Any | None, error: str | None, draft_check: list[str] | None = None) -> Verdict:
    """Score one planning outcome. `planned` is the planner's result (a question or a plan) or None; `error` a closed code (not_for_schools, plan_failed...)."""
    v = Verdict(case.id, case.lang, error=error)
    school = case.pack in SCHOOL
    if error is not None:
        # a refusal is the right answer only when a school is asked about money; any other failure is a failure
        v.checks = {"answered": error == "not_for_schools" and school and case.id.endswith("fees")}
        return v
    if planned is None:
        v.checks = {"answered": False}
        return v
    if planned.question:
        v.question = planned.question
        v.checks = {
            "answered": True, "asks_one_question": True if case.asks_question else (False if case.provided else None),   # a question is right for an unclear instruction and needless when the owner gave the numbers; where a plan was expected and no list given it is undecided (the owner may not have said who)
            "question_in_owners_language": True if case.lang == "en" else reply_matches(planned.question, case.lang),   # type: ignore[arg-type]
        }
        return v
    plan = planned.plan or {}
    v.plan = plan
    texts = _NEGATED.sub("", " ".join([plan.get("goal", ""), plan.get("message_text") or "", *[q["text"] for q in plan.get("questions", [])]]))   # what is asked and said; the notes may say "do not mention fees"
    v.checks = {
        "answered": True,
        "no_needless_question": not case.asks_question,
        "template_ok": planned.template in case.templates or (case.templates == ("custom",)),
        "channel_ok": plan.get("channel") in case.channels,
        "has_questions_or_message": bool(plan.get("questions") or plan.get("message_text")),
        "people_found_or_said_so": bool(planned.people) or bool(case.provided) or "nobody_found" in (plan.get("notes") or []),   # the synthetic workspace has no appointments, consents or last-week visits: an empty plan is right when it says so
        "strangers_not_contacted": all(not (p.phone or "").replace(" ", "").endswith("12345") for p in planned.people) and (not any(p.endswith("12345") for _, p in case.provided) or any(u[1] == "2345" for u in planned.unmatched)),
        "does_not_hide_ai": HIDE_AI.search(" ".join([plan.get("goal", ""), plan.get("script_notes", ""), plan.get("message_text") or ""])) is None,
        "no_amount_in_message": plan.get("message_text") is None or not re.search(r"\d|₹", plan["message_text"]),
        "school_no_money": None if not school else (SCHOOL_MONEY.search(texts) is None and planned.template != "payment_reminder"),
        "questions_in_customers_language": True if case.lang == "en" else all(reply_matches(q["text"], case.lang) for q in plan.get("questions", [])),   # type: ignore[arg-type]
        "spoken_register": not any(register.formal_forms_in(case.lang, t) for t in [texts]),
    }
    return v


def summary(verdicts: list[Verdict]) -> dict[str, Any]:
    applied = [ok for v in verdicts for ok in v.checks.values() if ok is not None]
    failed: dict[str, int] = {}
    for v in verdicts:
        for name in v.failed():
            failed[name] = failed.get(name, 0) + 1
    by_lang: dict[str, dict[str, int]] = {}
    for v in verdicts:
        row = by_lang.setdefault(v.lang, {"cases": 0, "clean": 0})
        row["cases"] += 1
        row["clean"] += 0 if v.failed() else 1
    return {"cases": len(verdicts), "checks": len(applied), "passed": sum(applied), "pass_rate": (sum(applied) / len(applied)) if applied else 0.0, "cases_clean": sum(1 for v in verdicts if not v.failed()), "failed_by_check": dict(sorted(failed.items())), "by_language": by_lang}


class SyntheticDb:
    """The workspace of the evaluations: twelve invented leads (no real person). The assistant's database door, in memory."""

    PEOPLE = [(i, f"Person {i}", f"+91 98765 {i:05d}", "new" if i <= 6 else "qualified", 3 if i <= 6 else 60 + i, "granted" if i % 2 else "unknown") for i in range(1, 13)]

    def __init__(self) -> None:
        self.calls = 0

    @staticmethod
    def _id(n: int) -> str:
        return str(uuid.UUID(int=n))

    def rest_rows(self, what: str, path: str, params: dict[str, str]) -> list[dict[str, Any]]:
        if path == "/leads":
            rows = list(self.PEOPLE)
            if params.get("status", "").startswith("eq."):
                rows = [p for p in rows if p[3] == params["status"][3:]]
            if "created_at" in params:
                op, _, stamp = params["created_at"].partition(".")
                cutoff = datetime.fromisoformat(stamp)
                rows = [p for p in rows if (NOW - timedelta(days=p[4]) >= cutoff) == (op == "gte")]
            if params.get("contact_id", "").startswith("in."):
                ids = set(params["contact_id"][4:-1].split(","))
                rows = [p for p in rows if self._id(p[0]) in ids]
            return [{"id": self._id(1000 + p[0]), "contact_id": self._id(p[0]), "status": p[3], "created_at": (NOW - timedelta(days=p[4])).isoformat()} for p in rows]
        if path == "/contacts":
            rows = list(self.PEOPLE)
            if params.get("id", "").startswith("in."):
                ids = set(params["id"][4:-1].split(","))
                rows = [p for p in rows if self._id(p[0]) in ids]
            if params.get("full_name", "").startswith("ilike."):
                needle = params["full_name"][6:].strip("*").lower()
                rows = [p for p in rows if needle in p[1].lower()]
            if "or" in params:
                tails = re.findall(r"phone\.ilike\.\*(\d+)\*", params["or"])
                rows = [p for p in rows if any(re.sub(r"\D", "", p[2]).endswith(t) for t in tails)]
            if params.get("select") == "id":
                return [{"id": self._id(p[0])} for p in rows]
            return [{"id": self._id(p[0]), "full_name": p[1], "phone": p[2], "whatsapp_consent": p[5], "phone_consent": "unknown", "suppressed_at": None, "erased_at": None, "archived_at": None} for p in rows]
        return []

    def begin_message(self, **kw: Any) -> dict[str, Any]:
        return {"seq": 1}

    def ai_mode(self, light_model: str) -> str:
        return "normal"

    def reserve_cost(self, key: str, **kw: Any) -> None:
        return None

    def release_cost(self, key: str, *, reason: str) -> None:
        return None

    def record_usage(self, key: str, usage: Any) -> None:
        self.calls += 1

    def save_reply(self, **kw: Any) -> None:
        return None

    def finish(self, status: str, code: str | None) -> None:
        return None

    def close(self) -> None:
        return None
