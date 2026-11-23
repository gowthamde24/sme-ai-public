#!/usr/bin/env python3
"""Export every Telugu and Kannada line for a native reviewer into ONE CSV (owner, 9 Nov 2026).

    python3 scripts/export_native_review.py ~/Desktop/stack19-jobs/native-review [--translate]

Columns: language, where it is used, the text, the English meaning, "OK / change to" (empty, for the reviewer). Rows come in this order:
  1. PHONE: what the phone assistant and Live talk say (services/ai-api/app/telephony, conversation, ...), then the five example calls per language, the voice sample lines and the call words.
  2. APP (API): other Telugu/Kannada text the API writes for the app (assistant answers, messages), found as {"te": ..., "kn": ...} tables in the code.
  3. APP (screens): the web app's strings (apps/web/i18n/strings/*.json), in file order. A string with no Telugu/Kannada translation yet (the text is still English) is left out.

The English meaning is the English text next to it in the same table when there is one (the app's own English). A line with none (the example calls) is translated by the fast model when `--translate` is given
(ANTHROPIC_API_KEY in the environment; a few hundred short lines, a few cents); it is then a machine translation, for the reviewer to correct. Nothing else is sent anywhere.
Words used by rules and not spoken as a sentence (the goodbye words, the language names) are not included."""

# ruff: noqa: E501

from __future__ import annotations

import ast
import csv
import json
import os
import re
import sys
from collections import OrderedDict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
API = ROOT / "services" / "ai-api" / "app"
WEB = ROOT / "apps" / "web" / "i18n" / "strings"
SCRIPT = {"te": re.compile("[ఀ-౿]"), "kn": re.compile("[ಀ-೿]")}
LANG_NAME = {"te": "Telugu", "kn": "Kannada"}

# files whose Telugu/Kannada text is spoken by the phone assistant or Live talk, with a label per table (the file name is shown for the rest)
PHONE_FILES = ("telephony/persona.py", "conversation/turntaking.py", "conversation/fillers.py", "telephony/outcome.py", "opening/honesty.py", "opening/render.py", "talk_training/guard.py", "conversation/voices.py", "voice/samples.py",
               "tasks/dialer.py", "tasks/compose.py", "tasks/report.py", "browser_voice/session.py", "browser_voice/routes.py", "conversation/style.py")   # (in this order in the file: the call itself first)
LABELS = {
    "INBOUND_OPENING": "Phone: the opening line of an incoming call (says it is an AI)",
    "HONEST_AI": "Phone: the answer to 'are you a person or a robot?'",
    "CALL_BYE": "Phone: the closing line when the caller says bye",
    "CALL_BYE_QUIET": "Phone: the closing line after a long silence",
    "CALL_CHECK_IN": "Phone: the check-in after a silence ('are you there?')",
    "INTERRUPTED_ACK": "Phone: the short acknowledgement after the caller cut in",
    "ACKS": "Phone: acknowledgement words the model is told to use (not a sentence)",
    "RESPECT": "Phone: the respectful words the model is told to use (not a sentence)",
    "STOP_ACK": "Phone: the answer to 'do not call me again'",
    "VOICEMAIL_MESSAGE": "Phone: the message left on a voicemail",
    "SAMPLE_LINES": "Voice picker: the sample line each voice speaks",
    "GOODBYE_QUIET": "Live talk: the closing after a long silence",
    "GOODBYE_REPLY": "Live talk: the reply to bye",
    "SOFT_WARNING": "Live talk: the two-minutes-left notice",
    "FILLERS": "Phone/Live talk: a short 'one moment' while the model thinks",
    "HANDOVER_ACK": "Phone: what it says when the caller asks for a person",
    "AFTER_HOURS": "Phone: what it says when the business is closed",
    "AI_ASSISTANT_WORD": "Phone: how 'AI assistant' is written in the language",
    "CHECK_IN": "Live talk: the check-in after a silence ('are you there?')",
    "BANK_LINES": "Phone/Live talk: the 'one moment' lines recorded in each voice (two versions: woman's and man's speech)",
    "OWNER_GREETING": "Live talk: the greeting to the owner when they start talking to the assistant",
    "HONEST_ANSWER": "Phone/Live talk: the honest answer to 'are you a robot?' (outbound calls)",
    "DISCLOSURE": "Outbound call: the AI disclosure at the start",
    "OPENERS": "Outbound call: the opening line",
    "SAFE": "Phone: the line spoken when a sentence would break the 'never say' list",
    "LINES": "Voice picker: the sample line each voice speaks",
    "LANG_NAMES": "Voice picker: the language name",
}


def _eval(node: ast.AST) -> object | None:
    try:
        return ast.literal_eval(node)
    except Exception:  # noqa: BLE001, S110 - not a plain constant: the next lines try a joined string
        pass
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
        left, right = _eval(node.left), _eval(node.right)
        if isinstance(left, str) and isinstance(right, str):
            return left + right
    return None


def _texts(value: object) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, (tuple, list)) and all(isinstance(x, str) for x in value):
        return list(value)
    return []


def api_tables() -> list[dict[str, object]]:
    """Every {"te": ..., "kn": ...} table in the API, with its name and the English next to it."""
    out: list[dict[str, object]] = []
    for path in sorted(API.rglob("*.py")):
        rel = path.relative_to(API).as_posix()
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001, S112 - a file that does not parse has no tables
            continue
        parents = {id(c): p for p in ast.walk(tree) for c in ast.iter_child_nodes(p)}
        for node in ast.walk(tree):
            if not isinstance(node, ast.Dict):
                continue
            entries = {k.value: v for k, v in zip(node.keys, node.values, strict=False) if isinstance(k, ast.Constant) and isinstance(k.value, str)}
            if "te" not in entries or "kn" not in entries:
                continue
            name, cur, trail = "", node, []
            while id(cur) in parents:
                par = parents[id(cur)]
                if isinstance(par, ast.Dict):
                    for k, v in zip(par.keys, par.values, strict=False):
                        if v is cur and isinstance(k, ast.Constant):
                            trail.append(str(k.value))
                if isinstance(par, (ast.Assign, ast.AnnAssign)):
                    target = par.targets[0] if isinstance(par, ast.Assign) else par.target
                    if isinstance(target, ast.Name):
                        name = target.id
                    break
                cur = par
            if not name:
                name = f"line {node.lineno}"
            out.append({"file": rel, "name": name, "trail": ".".join(reversed(trail)), "line": node.lineno,
                        "te": _texts(_eval(entries["te"])), "kn": _texts(_eval(entries["kn"])), "en": _texts(_eval(entries["en"])) if "en" in entries else []})
    return out


def example_rows() -> list[dict[str, str]]:
    data = json.loads((API / "telephony" / "data" / "call_examples.json").read_text(encoding="utf-8"))["languages"]
    rows = []
    for lang in ("te", "kn"):
        for n, call in enumerate(data[lang], 1):
            for t, turn in enumerate(call["turns"], 1):
                for who, text in turn.items():
                    rows.append({"lang": lang, "where": f"Phone: example call {n} ({call['persona']}), turn {t}, {'the CALLER says' if who == 'caller' else 'the ASSISTANT says'} (the assistant copies the style of these)", "text": str(text), "en": ""})
    return rows


def web_rows() -> list[dict[str, str]]:
    rows = []
    for name in ("login", "signup", "site", "app"):
        data = json.loads((WEB / f"{name}.json").read_text(encoding="utf-8"))
        for key, value in data.items():
            if not isinstance(value, dict) or "en" not in value:
                continue
            for lang in ("te", "kn"):
                text = value.get(lang)
                if isinstance(text, str) and text.strip() and text.strip() != str(value["en"]).strip() and SCRIPT[lang].search(text):
                    rows.append({"lang": lang, "where": f"App screen: {name}.json: {key}", "text": text, "en": str(value["en"])})
    return rows


def translate(rows: list[dict[str, str]]) -> None:
    """The fast model gives the English meaning of the lines that have none."""
    import httpx

    key = os.environ.get("ANTHROPIC_API_KEY", "")
    todo = [r for r in rows if not r["en"]]
    if not key or not todo:
        return
    system = ("You give the English meaning of lines of Telugu or Kannada that an AI phone assistant for an Indian shop says or hears. For each numbered line answer with its plain English meaning, faithful and short, "
              "keeping {placeholders} as they are. Answer ONLY a JSON array of strings, one per line, in order.")
    for i in range(0, len(todo), 30):
        batch = todo[i:i + 30]
        body = {"model": "claude-haiku-5-5", "max_tokens": 4000, "system": system, "thinking": {"type": "disabled"},
                "messages": [{"role": "user", "content": "\n".join(f"{n}. {r['text']}" for n, r in enumerate(batch, 1))}]}
        resp = httpx.post("https://api.anthropic.com/v1/messages", headers={"x-api-key": key, "anthropic-version": "2023-06-01"}, json=body, timeout=90)
        resp.raise_for_status()
        text = resp.json()["content"][0]["text"]
        answers = json.loads(text[text.index("["):text.rindex("]") + 1])
        for r, a in zip(batch, answers, strict=False):
            r["en"] = f"(machine translation) {a}"


def main() -> None:
    out_dir = Path(sys.argv[1]).expanduser()
    out_dir.mkdir(parents=True, exist_ok=True)
    phone: list[dict[str, str]] = []
    other: list[dict[str, str]] = []
    tables = sorted(api_tables(), key=lambda t: (PHONE_FILES.index(str(t["file"])) if str(t["file"]) in PHONE_FILES else 99, str(t["file"]), int(t["line"])))   # type: ignore[call-overload]
    for t in tables:
        is_phone = str(t["file"]) in PHONE_FILES
        label = LABELS.get(str(t["name"]), f"{str(t['file'])}: {t['name']}{('.' + str(t['trail'])) if t['trail'] else ''}")
        if is_phone and not label.startswith(("Phone", "Live", "Voice")):
            label = f"Phone/Live talk: {label}"
        if not is_phone:
            label = f"App (written by the API): {label}"
        for lang in ("te", "kn"):
            texts = t[lang]
            english = t["en"]
            for i, text in enumerate(texts):  # type: ignore[arg-type]
                if not SCRIPT[lang].search(text):
                    continue
                en = english[i] if isinstance(english, list) and i < len(english) else ""
                (phone if is_phone else other).append({"lang": lang, "where": label, "text": text, "en": en})
    phone += example_rows()
    # the same text in two places is one row with both places
    def dedupe(rows: list[dict[str, str]]) -> list[dict[str, str]]:
        seen: OrderedDict[tuple[str, str], dict[str, str]] = OrderedDict()
        for r in rows:
            k = (r["lang"], r["text"])
            if k in seen:
                if r["where"] not in seen[k]["where"]:
                    seen[k]["where"] += " | " + r["where"]
                seen[k]["en"] = seen[k]["en"] or r["en"]
            else:
                seen[k] = dict(r)
        return list(seen.values())
    phone, other, screens = dedupe(phone), dedupe(other), web_rows()
    if "--translate" in sys.argv:
        translate(phone)
        translate(other)
    rows = phone + other + screens
    path = out_dir / "native-review-telugu-kannada.csv"
    with path.open("w", encoding="utf-8-sig", newline="") as f:   # with a byte-order mark, so Excel and Numbers read the scripts
        w = csv.writer(f)
        w.writerow(["language", "where it is used", "text", "English meaning", "OK / change to"])
        for r in rows:
            w.writerow([LANG_NAME[r["lang"]], r["where"], r["text"], r["en"], ""])
    print(f"{path}: {len(rows)} rows = phone {len(phone)}, app (API) {len(other)}, app screens {len(screens)}; without an English meaning: {sum(1 for r in rows if not r['en'])}")


if __name__ == "__main__":
    main()
