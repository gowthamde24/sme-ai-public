"""The API's error-code catalog, read from the source (no running server, no database).

Every refusal the API sends has the one body of `app/errors.py`: {"error": {"code", "message", "retry_after", "request_id", ...closed extras}}. The `code` is the word the web maps to a plain-language sentence.
This module finds every code the source can send by reading the syntax tree of `services/ai-api/app`:

  1. `ApiError(status, "code", "sentence", ...)` with literal arguments;
  2. a literal table row `(status, "code", "sentence")` anywhere (the refusal tables of voice, photos, connectors, deliveries ...), because those rows reach the client through `ApiError(*row)`;
  3. `error_body("code", ...)` outside errors.py (the middleware answers), and the code words inside errors.py itself (status words, validation_error, internal_error ...);
  4. code FAMILIES built with an f-string (for example `indiamart_<word>`): listed by prefix, so the web can map the whole family with one sentence.

`make contracts` writes the result to packages/contracts/error_codes.{json,ts} and docs/contracts/error-codes.md. A test (tests/test_error_catalog.py) fails when the committed files are stale, so a new code
cannot ship unlisted, and fails when a code that was published disappears (a published code is never renamed or removed: the web may be mapping it; add a new code instead).
"""

from __future__ import annotations

import ast
import json
import re
from collections import defaultdict
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "services/ai-api/app"
CODE_RE = re.compile(r"[a-z][a-z0-9_]*")

# Codes that exist only through a code path the syntax tree cannot follow (a status word table, a third-party exception mapped by name). Keep this list short and give the reason.
SPECIAL: dict[str, tuple[int, str]] = {
    "internal_error": (500, "Something went wrong on our side."),  # the catch-all handler builds it with a variable status
    "http_error": (400, "Request failed."),  # any other HTTP status without its own word (see _STATUS_CODES in errors.py)
    "price_list_invalid": (422, "The file has problems. Nothing was saved."),  # built by hand in pricelists/routes.py with an extra top-level `issues` list
}
STATUS_WORD_MESSAGE = "Request failed."  # the sentence errors.py sends with the status words 400..429


def _name(call: ast.Call) -> str | None:
    f = call.func
    return f.id if isinstance(f, ast.Name) else (f.attr if isinstance(f, ast.Attribute) else None)


def _area(path: Path) -> str:
    rel = path.relative_to(APP)
    return rel.parts[0].removesuffix(".py") if len(rel.parts) > 1 else rel.stem


def _extras(call: ast.Call) -> set[str]:
    out: set[str] = set()
    for kw in call.keywords:
        if kw.arg == "extra" and isinstance(kw.value, ast.Dict):
            out |= {k.value for k in kw.value.keys if isinstance(k, ast.Constant) and isinstance(k.value, str)}
        if kw.arg == "retry_after":
            out.add("retry_after")
        if kw.arg == "headers":
            out.add("headers")
    return out


def scan() -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    codes: dict[str, dict[str, Any]] = defaultdict(lambda: {"statuses": set(), "areas": set(), "messages": [], "extras": set()})
    families: dict[str, dict[str, Any]] = defaultdict(lambda: {"statuses": set(), "areas": set()})

    def add(code: str, status: int | None, area: str, message: str | None, extras: set[str] | None = None) -> None:
        row = codes[code]
        if status is not None:
            row["statuses"].add(status)
        row["areas"].add(area)
        if message and message not in row["messages"]:
            row["messages"].append(message)
        row["extras"] |= extras or set()

    for path in sorted(APP.rglob("*.py")):
        area = _area(path)
        tree = ast.parse(path.read_text(encoding="utf-8"))
        is_errors = path == APP / "errors.py"
        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                name = _name(node)
                args = node.args
                if name == "ApiError" and len(args) >= 2 and isinstance(args[0], ast.Constant) and isinstance(args[0].value, int):
                    status = args[0].value
                    msg = args[2].value if len(args) >= 3 and isinstance(args[2], ast.Constant) and isinstance(args[2].value, str) else None
                    if isinstance(args[1], ast.Constant) and isinstance(args[1].value, str):
                        add(args[1].value, status, area, msg, _extras(node))
                    elif isinstance(args[1], ast.JoinedStr):
                        prefix = args[1].values[0].value if args[1].values and isinstance(args[1].values[0], ast.Constant) else ""
                        if prefix:
                            families[prefix]["statuses"].add(status)
                            families[prefix]["areas"].add(area)
                elif name == "error_body" and args and isinstance(args[0], ast.Constant) and isinstance(args[0].value, str):
                    msg = args[1].value if len(args) >= 2 and isinstance(args[1], ast.Constant) and isinstance(args[1].value, str) else None
                    add(args[0].value, None, area, msg)
            elif isinstance(node, ast.Tuple) and len(node.elts) >= 3 and all(isinstance(e, ast.Constant) for e in node.elts[:3]):
                status, code, sentence = (e.value for e in node.elts[:3])
                if isinstance(status, int) and 400 <= status < 600 and isinstance(code, str) and CODE_RE.fullmatch(code) and isinstance(sentence, str) and len(sentence) > 8:
                    add(code, status, area, sentence)
            elif is_errors and isinstance(node, ast.Dict):
                # _STATUS_CODES = {400: "bad_request", ...}
                for k, v in zip(node.keys, node.values, strict=False):
                    if isinstance(k, ast.Constant) and isinstance(k.value, int) and 400 <= k.value < 600 and isinstance(v, ast.Constant) and isinstance(v.value, str) and CODE_RE.fullmatch(v.value):
                        add(v.value, k.value, area, STATUS_WORD_MESSAGE)
    for code, (status, message) in SPECIAL.items():
        add(code, status, "errors", message)
    return codes, families


def catalog() -> dict[str, Any]:
    codes, families = scan()
    rows = []
    for code in sorted(codes):
        row = codes[code]
        statuses = sorted(row["statuses"])
        rows.append(
            {
                "code": code,
                "statuses": statuses,
                "areas": sorted(row["areas"]),
                "default_message": sorted(row["messages"], key=lambda m: (len(m), m))[0] if row["messages"] else "",
                "wait": 429 in statuses or "retry_after" in row["extras"],
                "extras": sorted(row["extras"] - {"retry_after", "headers"}),
            }
        )
    fam = [{"prefix": p, "statuses": sorted(v["statuses"]), "areas": sorted(v["areas"])} for p, v in sorted(families.items())]
    return {
        "version": 1,
        "note": "Every code the API can send in error.code. A published code is never renamed or removed. `wait` means error.retry_after can be set (also the Retry-After header). `extras` are the closed extra fields that can come with it. "
        "Extra fields are optional: treat every one as optional. A code that is not in this list must be shown with the sentence in error.message, or a generic 'something went wrong'. `default_message` is the English sentence the server sends today.",
        "codes": rows,
        "families": fam,
    }


def json_text() -> str:
    return json.dumps(catalog(), indent=2, ensure_ascii=False) + "\n"


def ts_text() -> str:
    c = catalog()
    codes = ",\n".join(f'  "{r["code"]}"' for r in c["codes"])
    fams = ",\n".join(f'  "{f["prefix"]}"' for f in c["families"])
    return (
        "/** Generated by scripts/error_catalog.py (make contracts). Do not edit. Mirrors error_codes.json. */\n"
        "export const API_ERROR_CODES = [\n" + codes + ",\n] as const;\n\n"
        "export type ApiErrorCode = (typeof API_ERROR_CODES)[number];\n\n"
        "/** Codes that come as a prefix plus a word (for example indiamart_<word>): map the whole family with one sentence. */\n"
        "export const API_ERROR_CODE_FAMILIES = [\n" + fams + ",\n] as const;\n\n"
        "export function isKnownApiErrorCode(code: string): code is ApiErrorCode {\n"
        "  return (API_ERROR_CODES as readonly string[]).includes(code);\n"
        "}\n"
    )


def md_text() -> str:
    c = catalog()
    out = [
        "# API error codes (generated: do not edit by hand)",
        "",
        "Generated by `scripts/error_catalog.py` (`make contracts`); a test fails when this file is stale. Machine-readable twins: `packages/contracts/error_codes.json` and `error_codes.ts`.",
        "",
        "Every refusal has one body: `{\"error\": {\"code\", \"message\", \"retry_after\", \"request_id\", ...}}`. The web maps `code` to its own plain-language sentence and keeps `request_id` for the person to quote.",
        "",
        "## Promises",
        "",
        "- A published code is never renamed, removed or given another meaning. A new situation gets a new code. A test fails if a published code disappears from the source.",
        "- The HTTP status of a code can gain a value but never changes meaning. Map by `code`, not by status.",
        "- `wait`: `retry_after` (whole seconds, also the `Retry-After` header) can be set; show \"try again in N seconds\" and do not retry sooner.",
        "- Extras are optional and differ by code. The common ones: `reason` (a closed word), `until` (a time), `fields` (the NAMES of the refused fields). Some codes carry others (the Extras column lists the keys per code). They do not repeat what the person submitted. **A client must treat every extra field as optional and ignore one it does not know.**",
        "- A code the web does not know yet: show `message` (the server's English sentence) or the generic \"Something went wrong\", plus `request_id`.",
        "",
        f"## Codes ({len(c['codes'])})",
        "",
        "| Code | Status | Area | Wait | Extras | Sentence the server sends today |",
        "|---|---|---|---|---|---|",
    ]
    for r in c["codes"]:
        msg = (r["default_message"] or "(the sentence varies: show `message`)").replace("|", "\\|")
        out.append(f"| `{r['code']}` | {', '.join(map(str, r['statuses'])) or 'any'} | {', '.join(r['areas'])} | {'yes' if r['wait'] else ''} | {', '.join(r['extras'])} | {msg} |")
    out += ["", f"## Families ({len(c['families'])})", "", "A prefix followed by a closed word (for example `indiamart_` + `timeout`). Map the whole family with one sentence and use `message` for detail.", "", "| Prefix | Status | Area |", "|---|---|---|"]
    for f in c["families"]:
        out.append(f"| `{f['prefix']}<word>` | {', '.join(map(str, f['statuses']))} | {', '.join(f['areas'])} |")
    return "\n".join(out) + "\n"


PUBLISHED = ROOT / "packages/contracts/error_codes.published.txt"


def published_text() -> str:
    """The append-only list of every code that was ever in the catalog. `make contracts` adds new codes and never removes one; a test fails when a listed code is gone from the source."""
    old = set(PUBLISHED.read_text(encoding="utf-8").split()) if PUBLISHED.exists() else set()
    return "\n".join(sorted(old | {r["code"] for r in catalog()["codes"]})) + "\n"


def write() -> None:
    PUBLISHED.write_text(published_text(), encoding="utf-8")
    (ROOT / "packages/contracts/error_codes.json").write_text(json_text(), encoding="utf-8")
    (ROOT / "packages/contracts/error_codes.ts").write_text(ts_text(), encoding="utf-8")
    (ROOT / "docs/contracts/error-codes.md").write_text(md_text(), encoding="utf-8")


if __name__ == "__main__":
    write()
    c = catalog()
    print(f"error catalog: {len(c['codes'])} codes, {len(c['families'])} families")
