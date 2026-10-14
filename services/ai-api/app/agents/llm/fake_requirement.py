"""A scripted, deterministic REQUIREMENT model (T008) for tests and local development: no key, no network. See `requirement_script`.

(Kept apart from `fake.py`: it is a long list of blunt rules.)"""

from __future__ import annotations

import re
from collections.abc import Sequence

from app.agents.llm.fake import _ADDRESSED_TO_AN_AI, Step, call, respond
from app.agents.llm.interface import LlmRequest, LlmResponse, ToolCall

# ---- a scripted REQUIREMENT model (T008): reads the enquiry block it is shown and proposes the fields the words state, with
# the words as quotes. It plays a CAREFUL model with blunt rules: it skips text addressed to an AI (an instruction is never
# a requirement), proposes nothing for a festival or a vague date, and proposes both values when the text gives two. It is a
# stand-in: real quality is measured only with a real model (after the owner's approval). For local development and tests.
_ENQUIRY_BLOCK = re.compile(r"received_on: ([0-9-]+)\nsubject: [^\n]*\ntext: ([^\n]*)")
_NUM = (
    r"(?:\d[\d,]*(?:\.\d+)?(?:\s*(?:dozen|doz|k|lakh|lac))?|(?:half\s+)?(?:a\s+)?dozen|"
    r"(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|"
    r"twenty[- ]five|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|"
    r"(?:one|two|three|four|five)\s+hundred|ek\s+sau|do\s+sau|bees|pachas|sau)(?:\s+dozen)?)"
)
_UNITS = r"(?:sarees?|saris?|pcs?|pieces?|nos)"


def _enquiry_blocks(request: LlmRequest) -> tuple[str, str] | None:
    for block in request.blocks:
        match = _ENQUIRY_BLOCK.search(block.text)
        if match:
            return match.group(1), match.group(2)
    return None


def _alternation(words: Sequence[str]) -> str:
    return "|".join(re.escape(w) for w in sorted(set(words), key=lambda w: (-len(w), w)))


def _requirement_plan(text: str) -> list[ToolCall]:  # noqa: C901 - a deliberately blunt rule list
    from app.requirements import vocabulary as V

    calls: list[ToolCall] = []
    # a careful reader does not take an order from a quoted earlier message ("> On Mon, Ravi wrote: ...")
    text = re.split(r"(?:^|\s)>\s", text, maxsplit=1)[0]
    clauses = [c for c in re.split(r"(?<=[.!?;])\s+|\s+\|\s+", text) if c.strip()]
    clauses = [c for c in clauses if not _ADDRESSED_TO_AN_AI.search(c)]
    types = _alternation([w for ws in V.SYNONYMS["saree_type"].values() for w in ws])
    colours = _alternation([w for ws in V.SYNONYMS["colour"].values() for w in ws])
    fabrics = _alternation([w for ws in V.SYNONYMS["fabric"].values() for w in ws])
    type_re = re.compile(rf"\b(?:{types})\b", re.I)
    colour_re = re.compile(rf"\b(?:{colours})\b", re.I)
    fabric_re = re.compile(rf"\b(?:{fabrics})\b", re.I)
    qty_before = re.compile(rf"({_NUM})\s+(?:[A-Za-z-]+\s+){{0,2}}?$", re.I)
    qty_after = re.compile(rf"^\W{{0,3}}(?:[A-Za-z-]+\s+){{0,3}}?\(?({_NUM})\s*{_UNITS}\b", re.I)
    qty_only = re.compile(rf"\b({_NUM})\s+{_UNITS}\b", re.I)
    line = 0
    for clause in clauses:
        mentions = list(type_re.finditer(clause))
        starts: list[tuple[int, int | None]] = []  # (segment start, qty span start)
        plans: list[dict[str, str | None]] = []
        for m in mentions:
            before = clause[: m.start()]
            qm = qty_before.search(before + " ")
            qty_text = None
            seg_start = m.start()
            if qm is not None and len(before) - qm.start() <= 45:
                seg_start = qm.start()
                qty_text = clause[qm.start() : m.end()]
                qty_value = qm.group(1)
            else:
                am = qty_after.search(clause[m.end() :])
                qty_text = am.group(0).strip(" ,(") if am else None
                qty_value = am.group(1) if am else None
            starts.append((seg_start, None))
            plans.append(
                {"type": m.group(0), "qty_quote": qty_text, "qty": qty_value if qty_text else None}
            )
        if not mentions:
            qm = qty_only.search(clause)
            if qm is not None:
                line += 1
                calls.append(
                    call(
                        "propose_field",
                        line=min(line, 5),
                        field="quantity",
                        value=qm.group(1),
                        certainty="stated",
                        quote=qm.group(0),
                    )
                )
            continue
        for index, plan in enumerate(plans):
            line += 1
            n = min(line, 5)
            seg_end = starts[index + 1][0] if index + 1 < len(starts) else len(clause)
            segment = clause[starts[index][0] : seg_end]
            calls.append(
                call(
                    "propose_field",
                    line=n,
                    field="saree_type",
                    value=str(plan["type"]),
                    certainty="stated",
                    quote=str(plan["type"]),
                )
            )
            if plan["qty"]:
                calls.append(
                    call(
                        "propose_field",
                        line=n,
                        field="quantity",
                        value=str(plan["qty"]),
                        certainty="stated",
                        quote=str(plan["qty_quote"]),
                    )
                )
            cm = colour_re.search(segment)
            if cm:
                calls.append(
                    call(
                        "propose_field",
                        line=n,
                        field="colour",
                        value=cm.group(0),
                        certainty="stated",
                        quote=cm.group(0),
                    )
                )
            for fm in fabric_re.finditer(segment):
                if any(tm.start() <= starts[index][0] + fm.start() < tm.end() for tm in mentions):
                    continue  # "silk" inside "Mysore silk" is the saree type, not a fabric
                calls.append(
                    call(
                        "propose_field",
                        line=n,
                        field="fabric",
                        value=fm.group(0),
                        certainty="stated",
                        quote=fm.group(0),
                    )
                )
                break
    # ---- the order
    seen: set[tuple[str, str]] = set()

    def once(field: str, value: str, quote: str, certainty: str = "stated") -> None:
        if (field, value.casefold()) in seen:
            return
        seen.add((field, value.casefold()))
        calls.append(
            call("propose_field", field=field, value=value, certainty=certainty, quote=quote)
        )

    for clause in clauses:
        for m in re.finditer(
            r"\b(?i:deliver(?:y|ed)?|ship(?:ped|ping)?|send|dispatch)\s+(?i:it\s+|them\s+|the order\s+)?(?i:to|at|in)\s+"
            r"([A-Z][A-Za-z'-]*(?:\s+[A-Z][A-Za-z'-]*){0,2})",
            clause,
        ):
            once("delivery_city", m.group(1), m.group(1))
        for m in re.finditer(
            r"(?:\bbudget\b[^.\d₹]{0,15}|\bup to\b\s*|\bcan pay\b\s*)?"
            r"((?:rs\.?|inr|₹)\s*[\d,.]+(?:\s*(?:k|lakh|lac|crore))?(?:\s*(?:/-|only))?(?:\s*(?:per|each|a)\s*(?:piece|pc|saree|sari))?(?:\s*(?:total|overall))?"
            r"|\b\d[\d,.]*\s*(?:k|lakh|lac)\s*(?:per|each|a)?\s*(?:piece|pc|saree|sari)?)",
            clause,
            re.I,
        ):
            if re.search(r"budget|rs|inr|₹|each|per", m.group(0), re.I):
                once("budget", m.group(1).strip(), m.group(1).strip())
        for m in re.finditer(
            r"\b(\d{1,3}\s*(?:%|percent|per cent)\s*advance|full advance|advance payment|100% advance|net\s*\d{1,3}|"
            r"\d{1,3}\s*days?\s*(?:credit|payment|terms)|credit of \d{1,3} days|cash on delivery|\bcod\b|"
            r"payment (?:after|within) \d{1,3} days)",
            clause,
            re.I,
        ):
            once("payment_terms", m.group(1), m.group(1))
        if re.search(
            r"\b(?:diwali|deepavali|dussehra|pongal|ugadi|onam|eid|holi|festival|wedding season|sankranti|navratri)\b",
            clause,
            re.I,
        ) and not re.search(
            r"\d{1,2}[/-]\d{1,2}|\b\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\b", clause
        ):
            continue
        for rx in (
            r"\b\d{4}-\d{1,2}-\d{1,2}\b",
            r"\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b",
            rf"\b\d{{1,2}}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:{_alternation(list(_MONTH_WORDS))})\b\.?(?:,?\s*\d{{4}})?",
            rf"\b(?:{_alternation(list(_MONTH_WORDS))})\b\.?\s*\d{{1,2}}(?:st|nd|rd|th)?\b(?:,?\s*\d{{4}})?",
            r"\b(?:day after tomorrow|tomorrow|next week|end of next month|(?:by )?month[- ]?end|end of (?:this |the )?month)\b",
            r"\b(?:in|within)\s+\d{1,3}\s*(?:days?|weeks?)\b",
            r"\bnext\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b",
        ):
            for m in re.finditer(rx, clause, re.I):
                once(
                    "deadline",
                    m.group(0),
                    m.group(0),
                    "implied" if not re.search(r"\d{4}", m.group(0)) else "stated",
                )
    return calls


_MONTH_WORDS = (
    "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november",
    "december", "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sept", "sep", "oct", "nov", "dec",
)  # fmt: skip


_AREA_RE = re.compile(r"(\d[\d,]*(?:\.\d+)?)\s*(?:sq\.?\s*ft|sqft|sft|sq\.?\s*m|sqm|square\s+(?:feet|meters|metres))\b", re.I)
_LXW_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(?:ft|feet|m)?\s*(?:x|by|\*)\s*(\d+(?:\.\d+)?)\s*(ft|feet|m|metres|meters)\b", re.I)
_THICK_RE = re.compile(r"(\d{2,3})\s*mm\b", re.I)
_QTY_RE = re.compile(r"(\d[\d,]*)\s*(?:bags?|tonnes?|tons?|cft|truck\s?loads?|trucks?|pcs|pieces|nos)\b", re.I)
_SITE_RE = re.compile(r"\b(?i:site|deliver(?:y|ed)?|located)\s+(?i:is\s+)?(?i:at|in|to|near)\s+([A-Z][A-Za-z'-]*(?:\s+[A-Z][A-Za-z'-]*){0,3})")
_NO_LAYING_RE = re.compile(r"\b(?:no laying|without laying|supply only|material only|laying not (?:needed|required)|we will lay)\b", re.I)
_LAYING_RE = re.compile(r"\b(?:with laying|laying (?:also )?(?:needed|required)|supply and (?:laying|fixing)|need laying)\b", re.I)


def _material_plan(text: str) -> list[ToolCall]:  # noqa: C901 - a deliberately blunt rule list
    from app.requirements import materials as M

    calls: list[ToolCall] = []
    text = re.split(r"(?:^|\s)>\s", text, maxsplit=1)[0]
    clauses = [c for c in re.split(r"(?<=[.!?;])\s+|\s+\|\s+", text) if c.strip()]
    clauses = [c for c in clauses if not _ADDRESSED_TO_AN_AI.search(c)]
    product_words = _alternation([w for ws in M.SYNONYMS["product_type"].values() for w in ws])
    application_words = _alternation([w for ws in M.SYNONYMS["application"].values() for w in ws])
    product_re = re.compile(rf"\b(?:{product_words})\b", re.I)
    application_re = re.compile(rf"\b(?:{application_words})\b", re.I)

    def prop(field: str, value: str, quote: str, line: int | None = None, certainty: str = "stated") -> None:
        args: dict[str, str | int] = {"field": field, "value": value, "certainty": certainty, "quote": quote}
        if line is not None:
            args["line"] = line
        calls.append(call("propose_field", **args))

    line = 0
    seen: set[tuple[str, str]] = set()
    for clause in clauses:
        products = list(product_re.finditer(clause))
        if products:
            line = min(line + 1, 5) if len(products) == 1 else line
        n = max(line, 1)
        for index, m in enumerate(products):
            if index and line < 5:
                line += 1
                n = line
            elif index == 0 and len(products) > 1:
                line = min(line + 1, 5)
                n = line
            prop("product_type", m.group(0), m.group(0), n)
        area = _AREA_RE.search(clause)
        lxw = _LXW_RE.search(clause)
        if lxw is not None:
            unit = lxw.group(3)
            prop("length", f"{lxw.group(1)} {unit}", lxw.group(0), n)
            prop("width", f"{lxw.group(2)} {unit}", lxw.group(0), n)
        elif area is not None:
            prop("area", area.group(0), area.group(0), n, "implied" if re.search(r"\b(?:about|around|approx|nearly|roughly)\b", clause, re.I) else "stated")
        thick = _THICK_RE.search(clause)
        if thick is not None:
            prop("thickness", thick.group(0), thick.group(0), n)
        qty = _QTY_RE.search(clause)
        if qty is not None and area is None and lxw is None:
            prop("quantity", qty.group(0), qty.group(0), n)
        am = application_re.search(clause)
        if am is not None and ("application", am.group(0).casefold()) not in seen:
            seen.add(("application", am.group(0).casefold()))
            prop("application", am.group(0), am.group(0))
        sm = _SITE_RE.search(clause)
        if sm is not None and ("site_location", sm.group(1).casefold()) not in seen:
            seen.add(("site_location", sm.group(1).casefold()))
            prop("site_location", sm.group(1), sm.group(1))
        lay = _NO_LAYING_RE.search(clause) or _LAYING_RE.search(clause)
        if lay is not None and ("laying", lay.group(0).casefold()) not in seen:
            seen.add(("laying", lay.group(0).casefold()))
            prop("laying", lay.group(0), lay.group(0))
    # budget, deadline and payment terms: the saree flow's rules read them the same way
    calls.extend(c for c in _requirement_plan(text) if c.arguments.get("field") in ("budget", "deadline", "payment_terms"))
    return calls


class _EnquiryReader:
    """Plans once, hands the calls out twelve at a time (a turn may carry twelve); the last chunk carries the final result."""

    def __init__(self, materials: bool = False) -> None:
        self._chunks: list[list[ToolCall]] | None = None
        self._next = 0
        self._materials = materials

    def __call__(self, request: LlmRequest) -> LlmResponse:
        if self._chunks is None:
            found = _enquiry_blocks(request)
            plan = _material_plan if self._materials else _requirement_plan
            calls = plan(found[1]) if found else []
            self._chunks = [calls[i : i + 12] for i in range(0, len(calls), 12)] or [[]]
        chunk = self._chunks[self._next] if self._next < len(self._chunks) else []
        self._next += 1
        last = self._next >= len(self._chunks)
        return respond(
            *chunk,
            structured={"summary": "DEMO requirement extraction finished.", "uncertainty": "medium"}
            if last
            else None,
            tokens_in=400,
            tokens_out=120,
        )


def requirement_script(materials: bool = False) -> list[Step]:
    reader = _EnquiryReader(materials)
    return [reader, reader, reader]
