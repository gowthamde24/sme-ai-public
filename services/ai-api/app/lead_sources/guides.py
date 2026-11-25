"""How to connect a CRM, an automation tool, a website form or a sheet to a lead address: DATA (data/guides.json), read once. Every body a guide sends is tested against the real intake (tests/test_lead_guides.py, tests/test_lead_templates.py).

A guide has `steps`, a `sample` body and a `mapping` (their field names to ours). It may also have:
  * `template`   a file to import (n8n: the workflow as JSON, with the address written in)
  * `recipe`     the settings of a tool, line by line (Zapier, Make, Pabbly), with the `payload` the tool sends once those settings are made
  * `snippet`    code to paste (Google Forms, Google Sheets, WordPress, Wix)
  * `also_sends` other bodies the guide's tool or code sends, each one tested too."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

PATH = Path(__file__).parent / "data" / "guides.json"
PLACEHOLDER = "{ADDRESS}"


@lru_cache(maxsize=1)
def _doc() -> dict[str, Any]:
    raw = json.loads(PATH.read_text(encoding="utf-8"))
    return raw if isinstance(raw, dict) else {}


def listing() -> list[dict[str, str]]:
    return [{"id": g["id"], "name": g["name"], "group": g["group"]} for g in _doc().get("guides", [])]


def guide(guide_id: str, address_url: str) -> dict[str, Any] | None:
    """One guide with the address written in (the real URL when the caller has it, else `.../YOUR-ADDRESS`)."""
    for g in _doc().get("guides", []):
        if g["id"] == guide_id:
            text = json.dumps(g, ensure_ascii=False).replace(PLACEHOLDER, address_url.replace("\\", "\\\\").replace('"', '\\"'))
            out: dict[str, Any] = json.loads(text)
            return out
    return None


def consent_note() -> str:
    return str(_doc().get("note", ""))


def n8n_body(workflow: dict[str, Any]) -> dict[str, str]:
    """The body an imported n8n workflow sends: the fields of its sample node that its request node names. Read from the workflow itself, so a test can post exactly that."""
    nodes = {n["name"]: n for n in workflow["nodes"]}
    sample = next(n for n in nodes.values() if n["type"] == "n8n-nodes-base.set")
    request = next(n for n in nodes.values() if n["type"] == "n8n-nodes-base.httpRequest")
    values = {a["name"]: a["value"] for a in sample["parameters"]["assignments"]["assignments"]}
    named = [k for k in values if f"$json.{k}" in request["parameters"]["jsonBody"]]
    return {k: values[k] for k in named}


def bodies(g: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    """Every body a guide sends, named by where it comes from: the sample, the recipe's payload, the workflow's, the others."""
    out: list[tuple[str, dict[str, Any]]] = [("sample", dict(g["sample"]))]
    recipe, template = g.get("recipe"), g.get("template")
    if isinstance(recipe, dict) and isinstance(recipe.get("payload"), dict):
        out.append(("recipe", dict(recipe["payload"])))
    if isinstance(template, dict) and isinstance(template.get("workflow"), dict):
        out.append(("template", dict(n8n_body(template["workflow"]))))
    out.extend((f"also_sends[{i}]", dict(b)) for i, b in enumerate(g.get("also_sends") or []))
    return out


def web_text(guide_id: str, address: str = "YOUR_ADDRESS") -> str:
    """The extra text the web guide page shows under its first code block (apps/web/lib/lead-desk/guide-snippets.json): the ready files, the settings and the field names of each tool of that page's group.
    `auto` = the automation tools, `crm` = the CRMs, `web` = the website tools. Plain lines; the address is written as YOUR_ADDRESS, as everywhere on that page."""
    group = {"auto": "automation", "crm": "crm", "web": "website"}.get(guide_id)
    if group is None:
        return ""
    blocks: list[str] = []
    for item in _doc().get("guides", []):
        if item["group"] != group:
            continue
        g = guide(item["id"], address) or item
        lines = [f"# {g['name']}"]
        template, recipe = g.get("template"), g.get("recipe")
        if isinstance(template, dict):
            lines += [f"# {template['title']} (save as {template['filename']}). {template['how']}", json.dumps(template["workflow"], indent=2, ensure_ascii=False)]
        if isinstance(recipe, dict):
            lines += [f"# {recipe['title']}", *recipe["lines"]]
        if group == "crm":
            lines += [f"{theirs} -> {ours}" for theirs, ours in g["mapping"].items()]
        if isinstance(g.get("snippet"), str):
            lines.append(g["snippet"])
        if len(lines) > 1:
            blocks.append("\n".join(lines))
    return "\n\n".join(blocks)
