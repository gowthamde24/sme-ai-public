# ruff: noqa: E501
"""No company can receive personal data before the processors list says so (owner, 12 Nov 2026).

Every external host the API code (string constants, not docstrings or comments) or the deploy scripts (not their comments) can call must be in app/dpdp/data/external_hosts.json. A 'processor' entry must name an id on
app/dpdp/data/subprocessors.json. A 'dormant' provider names the settings that would switch it on and no deploy script may set them; a 'staging_only' host may not appear in deploy/production.sh. When this fails
because of a new host: add the company to subprocessors.json FIRST (the owner approves the list), then register the host here as its 'processor'."""

from __future__ import annotations

import ast
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
APP = ROOT / "services" / "ai-api" / "app"
DATA = APP / "dpdp" / "data"
URL = re.compile(r"(?:https?|wss?)://([A-Za-z0-9][A-Za-z0-9._-]*\.[A-Za-z]{2,})")
REGISTER = json.loads((DATA / "external_hosts.json").read_text(encoding="utf-8"))
LIST_IDS = {s["id"] for s in json.loads((DATA / "subprocessors.json").read_text(encoding="utf-8"))["subprocessors"]}
KINDS = {"processor", "source", "dormant", "staging_only", "link", "own", "ignored"}
DEPLOY = [ROOT / "deploy" / name for name in ("staging.sh", "production.sh", "cloudrun.sh")]


def code_hosts() -> dict[str, set[str]]:
    found: dict[str, set[str]] = {}
    for path in sorted(APP.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        docstrings = {
            id(node.body[0].value)
            for node in ast.walk(tree)
            if isinstance(node, ast.Module | ast.ClassDef | ast.FunctionDef | ast.AsyncFunctionDef) and node.body and isinstance(node.body[0], ast.Expr)
            and isinstance(node.body[0].value, ast.Constant) and isinstance(node.body[0].value.value, str)
        }
        for node in ast.walk(tree):
            if isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in docstrings:
                for host in URL.findall(node.value):
                    found.setdefault(host.lower(), set()).add(str(path.relative_to(ROOT)))
    for script in DEPLOY:
        for line in script.read_text(encoding="utf-8").splitlines():
            if line.lstrip().startswith("#"):
                continue
            for host in URL.findall(line.split(" # ")[0]):
                found.setdefault(host.lower(), set()).add(str(script.relative_to(ROOT)))
    return found


def entry_of(host: str) -> dict[str, object] | None:
    hosts: dict[str, dict[str, object]] = REGISTER["hosts"]
    if host in hosts:
        return hosts[host]
    for suffix, entry in REGISTER["suffixes"].items():
        if host.endswith(suffix):
            return entry  # type: ignore[no-any-return]
    return None


def kind_of(entry: dict[str, object]) -> str:
    kinds = [k for k in KINDS if k in entry]
    assert len(kinds) == 1, f"an entry has exactly one status: {entry}"
    return kinds[0]


def test_every_external_host_the_code_or_the_deploy_can_call_is_registered() -> None:
    missing = {h: sorted(files) for h, files in code_hosts().items() if entry_of(h) is None}
    assert not missing, f"unregistered external hosts {missing}: add the company to subprocessors.json (owner approves the list), then register the host in external_hosts.json"


def test_a_processor_is_a_company_on_the_list_and_every_entry_says_why() -> None:
    for host, entry in {**REGISTER["hosts"], **REGISTER["suffixes"]}.items():
        kind = kind_of(entry)
        assert kind in KINDS
        if kind == "processor":
            assert entry["processor"] in LIST_IDS, f"{host}: {entry['processor']} is not on subprocessors.json"
        else:
            assert isinstance(entry[kind], str) and entry[kind], f"{host}: a reason is needed"
        if kind == "dormant":
            assert entry.get("env"), f"{host}: name the settings that would switch it on"


def test_a_registered_host_is_still_used_so_the_register_does_not_rot() -> None:
    used = code_hosts()
    stale = [h for h in REGISTER["hosts"] if h not in used]
    assert not stale, f"registered but no longer in the code or the deploy scripts: {stale}"


def test_no_deploy_script_switches_on_a_dormant_provider() -> None:
    text = "\n".join("\n".join(line for line in script.read_text(encoding="utf-8").splitlines() if not line.lstrip().startswith("#")) for script in DEPLOY)
    dormant = [e for e in [*REGISTER["hosts"].values(), *REGISTER["dormant_without_host"]] if "dormant" in e]
    for entry in dormant:
        for name in entry["env"]:
            assert not re.search(rf"\b{name}\b", text), f"{name} is set by a deploy script but its provider is registered as dormant ({entry['dormant']}): move it to a 'processor' after the list names it"


def test_a_staging_only_host_never_reaches_production() -> None:
    production = "\n".join(line for line in (ROOT / "deploy" / "production.sh").read_text(encoding="utf-8").splitlines() if not line.lstrip().startswith("#"))
    for host, entry in REGISTER["hosts"].items():
        if "staging_only" in entry:
            assert host not in production, f"{host} is staging-only but production.sh names it"


def test_the_guard_really_rejects_a_host_nobody_registered_and_accepts_ours() -> None:
    assert entry_of("api.newvendor.example.com") is None, "an unknown host must not pass"
    assert entry_of("abc.supabase.co") == {"processor": "supabase"}
    assert entry_of("sme-api-1.asia-south1.run.app") == {"processor": "google_cloud"}
