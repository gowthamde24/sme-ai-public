"""`GET /jobs/templates`: the job templates of the workspace's business type, and the other business types' (jobs contract 1.1 part 1, section 1).

The pack id comes from the database (the workspace's pinned pack); code never names a pack. Everything optional (the shop's first item, the real prospects) is best effort: a failure there never fails the
answer, the sheet just draws without it.
"""

# ruff: noqa: E501

from __future__ import annotations

import json
import logging
import uuid
from pathlib import Path
from typing import Any

from app.catalogue import service as catalogue_service
from app.jobs import identity, packdata
from app.jobs.models import (
    BusinessTypeOut,
    ExampleOut,
    OtherPackOut,
    PackJobsOut,
    PreviewOut,
    SampleOut,
    TemplateOut,
    TemplatesOut,
    Why,
)
from app.lead_finder.models import ProspectOut

logger = logging.getLogger("app.jobs.templates")

GET_PAID = "get_paid"
REAL_EXAMPLES = 3
WELL_RATED_MIN = 4.2
WELL_RATED_MIN_REVIEWS = 20
MAX_TEXT = 60


def why_of(p: ProspectOut) -> Why | None:
    """The one honest reason a real prospect fits, from what we hold about it. `near_you` (no distance is stored), `open_business` (no opening state is stored) and `sells_what_you_buy_from` (we hold no
    supplier data) are never sent: a code is sent only when a stored field supports it."""
    if p.rating is not None and p.review_count is not None and p.rating >= WELL_RATED_MIN and p.review_count >= WELL_RATED_MIN_REVIEWS:
        return Why(code="well_rated", params={"rating": f"{p.rating:.1f}", "count": p.review_count})
    if p.category and p.category.strip():
        return Why(code="category_match", params={"category": p.category.strip()[:MAX_TEXT]})
    return None


def real_examples(prospects: list[ProspectOut]) -> list[ExampleOut]:
    out: list[ExampleOut] = []
    for p in prospects:
        if not (p.name and p.area and p.fit_score is not None):
            continue
        why = why_of(p)
        fields: dict[str, Any] = {"name": p.name.strip()[:MAX_TEXT], "area": p.area.strip()[:MAX_TEXT], "fit": max(0, min(100, int(p.fit_score)))}
        if why is not None:
            fields["why"] = why
        out.append(ExampleOut(**fields))
    return out


def template_out(t: packdata.JobTemplate, real: list[ExampleOut] | None = None) -> TemplateOut:
    fields: dict[str, Any] = {
        "id": t.id, "kind": t.kind, "goal": t.goal, "popular": t.popular, "title": dict(t.title), "benefit": dict(t.benefit), "ask": dict(t.ask),
        "needs": list(t.needs), "finds_out": list(t.finds_out), "season": t.season,
    }  # fmt: skip
    if t.whatsapp or t.call:
        preview: dict[str, Any] = {"sample_audio": t.sample_audio}
        if t.whatsapp:
            preview["whatsapp"] = dict(t.whatsapp)
        if t.call:
            preview["call"] = dict(t.call)
        fields["preview"] = PreviewOut(**preview)
    if t.sample_item:
        fields["sample_item"] = dict(t.sample_item)
    if t.kind == "researcher":
        if real:
            fields["examples"] = real
            fields["examples_real"] = True
        else:
            fields["examples"] = [ExampleOut(name=e.name, area=e.area, why=dict(e.why)) for e in t.examples]
            fields["examples_real"] = False
    return TemplateOut(**fields)


def pack_jobs_out(jobs: packdata.PackJobs, *, get_paid: bool, real: list[ExampleOut] | None = None) -> PackJobsOut:
    return PackJobsOut(
        status=jobs.status, pack=jobs.pack_id, version=jobs.version,
        templates=[template_out(t, real) for t in jobs.templates if get_paid or t.goal != GET_PAID],
    )  # fmt: skip


def _pack_json_names(pack_id: str, directory: Path | None) -> dict[str, str]:
    if directory is None:
        return {}
    try:
        names = json.loads((directory / pack_id / "pack.json").read_text(encoding="utf-8")).get("names")
    except (OSError, ValueError, AttributeError):
        return {}
    return {k: v for k, v in names.items() if isinstance(v, str)} if isinstance(names, dict) else {}


def pack_names(pack_id: str, directory: Path | None, fallback: dict[str, str] | None = None) -> dict[str, str]:
    """The plural name of a business type: identity.json's `plural_names`, else the pack's own (singular) `names` from pack.json, else `fallback`."""
    found = identity.for_pack(pack_id, directory)
    if found is not None:
        return dict(found.plural_names)
    return _pack_json_names(pack_id, directory) or dict(fallback or {"en": pack_id.replace("_", " ")})


def other_pack_ids(directory: Path | None, own: str) -> list[str]:
    if directory is None or not directory.is_dir():
        return []
    return sorted(p.name for p in directory.iterdir() if p.is_dir() and p.name != own and (p / "jobs.json").is_file())


def first_item_name(catalogue: Any, token: str, tenant_id: uuid.UUID) -> str | None:
    """The name of the shop's first active catalogue item, as the shop wrote it. None when there is none or it cannot be read."""
    if catalogue is None:
        return None
    try:
        rows = catalogue.search(token, tenant_id, catalogue_service.search_args(fabric=None, colours=None, occasions=None, price_bands=None, in_stock_only=False, include_inactive=False, limit=1, after=None))
    except Exception as exc:  # noqa: BLE001 - a sample line is a nicety (a business type with no catalogue answers a refusal here)
        logger.info("no sample item: %s", exc.__class__.__name__)
        return None
    name = str(rows[0].get("name") or "").strip() if rows else ""
    return name or None


def real_prospects(lead_finder: Any, token: str, tenant_id: uuid.UUID) -> list[ExampleOut]:
    if lead_finder is None:
        return []
    try:
        return real_examples(lead_finder.best_prospects(token, tenant_id, REAL_EXAMPLES))
    except Exception as exc:  # noqa: BLE001 - the Lead Finder may be off or not for this business type: the invented examples stand
        logger.info("no real examples: %s", exc.__class__.__name__)
        return []


def build(*, pack_id: str, manifest_names: dict[str, str], directory: Path | None, get_paid: bool, item_name: str | None, real: list[ExampleOut]) -> TemplatesOut:
    own = packdata.for_pack(pack_id, directory)
    own_out = (
        pack_jobs_out(own, get_paid=get_paid, real=real)
        if own is not None
        else PackJobsOut(status=packdata.STATUS, pack=pack_id, version=1, templates=[])
    )  # fail closed: a pack whose file was refused has no templates, the other types are still shown
    others: list[OtherPackOut] = []
    for other_id in other_pack_ids(directory, pack_id):
        jobs = packdata.for_pack(other_id, directory)
        if jobs is not None:
            others.append(OtherPackOut(pack=other_id, name=pack_names(other_id, directory), jobs=pack_jobs_out(jobs, get_paid=get_paid)))
    others.sort(key=lambda o: (_pack_json_names(o.pack, directory).get("en") or o.pack).casefold())  # by the business type's own English name (pack.json names.en), as the contract says
    fields: dict[str, Any] = {
        "business_type": BusinessTypeOut(pack=pack_id, name=pack_names(pack_id, directory, manifest_names)),
        "own": own_out,
        "others": others,
    }
    if item_name:
        fields["sample"] = SampleOut(item={"en": item_name})
    return TemplatesOut(**fields)
