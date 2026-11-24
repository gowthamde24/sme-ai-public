"""Jobs, slice S2a (jobs contract 1.0 and 1.1 part 1): GET /jobs/templates and GET /jobs/festivals, with fakes (no database). The pack files are the real ones in packages/packs."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from typing import Any, cast

import pytest

from app import gstin as gstin_module
from app.jobs import packdata
from app.jobs.templates import why_of
from app.jobs.wiring import JobsRuntime
from app.lead_finder.models import ProspectOut
from tests.fakes import TENANT_A, TENANT_B, auth, make_client

PACKS = Path(__file__).resolve().parents[3] / "packages" / "packs"
A = TENANT_A.id
TEMPLATES = f"/v1/tenants/{A}/jobs/templates"
FESTIVALS = f"/v1/tenants/{A}/jobs/festivals"
NOW = "2026-10-14T09:00:00+00:00"


def clock(text: str = "2026-11-19T12:00:00+00:00") -> Callable[[], datetime]:
    moment = datetime.fromisoformat(text)
    return lambda: moment


def on(**kw: Any) -> JobsRuntime:
    return JobsRuntime(directory=PACKS, clock=kw.pop("clock", clock()), **kw)


class FakePacks:
    def __init__(self, pack_id: str = "textiles") -> None:
        self.pack_id = pack_id

    def workspace_pack(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return {"pack_id": self.pack_id, "version": 2, "status": "published", "validated": True, "source": "signup", "chosen_at": NOW, "manifest": {"names": {"en": "Fake pack", "te": "ఫేక్"}}, "modules": []}


class FakeCatalogue:
    def __init__(self, name: str | None = "Kanchipuram silk saree") -> None:
        self.name = name
        self.args: list[dict[str, Any]] = []

    def search(self, token: str, tenant_id: uuid.UUID, args: dict[str, Any], kind: str = "saree") -> list[dict[str, Any]]:
        self.args.append(args)
        return [{"name": self.name}] if self.name else []


def prospect(name: str = "Lotus Sarees", area: str | None = "Market Road", fit: int | None = 91, category: str | None = "Saree shop", rating: float | None = 4.6, reviews: int | None = 212) -> ProspectOut:
    return ProspectOut.model_validate({
        "id": uuid.uuid4(), "search_id": None, "name": name, "category": category, "area": area, "phone": None, "website": None, "rating": rating, "review_count": reviews, "lat": None, "lng": None,
        "source": "fixture", "source_label": "x", "attribution": None, "status": "call_ready", "decision_reason": None, "fit_score": fit, "fit_reason": "x", "stock_match": None, "owner_approved": False,
        "suppressed": False, "ask_after": None, "last_contacted_at": None, "lead_id": None, "qualification": None, "created_at": NOW, "updated_at": NOW,
    })  # fmt: skip


class FakeLeadFinder:
    def __init__(self, rows: list[ProspectOut] | Exception) -> None:
        self.rows = rows
        self.asked: list[int] = []

    def best_prospects(self, token: str, tenant_id: uuid.UUID, count: int) -> list[ProspectOut]:
        self.asked.append(count)
        if isinstance(self.rows, Exception):
            raise self.rows
        return self.rows[:count]


class FakeProfile:
    def __init__(self, gstin: str | None = None, error: Exception | None = None) -> None:
        self.gstin, self.error = gstin, error

    def get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        if self.error:
            raise self.error
        return {"gstin": self.gstin}


def gstin_of(state_code: str) -> str:
    first14 = f"{state_code}AAPFU0939F1Z"
    return first14 + gstin_module.check_character(first14)


def get(client: Any, path: str, user: str | None = "a_owner", **headers: str) -> Any:
    return client.get(path, headers={**(auth(user) if user else {}), **headers})


def every_template(body: dict[str, Any]) -> list[dict[str, Any]]:
    return [*body["own"]["templates"], *(t for o in body["others"] for t in o["jobs"]["templates"])]


# ------------------------------------------------------------------------------------------------------------------ JOBS off: not there
@pytest.mark.parametrize("path", [TEMPLATES, FESTIVALS])
@pytest.mark.parametrize("user", ["a_owner", "a_viewer", "outsider", None])
def test_with_jobs_off_every_route_is_a_404_as_if_it_did_not_exist(path: str, user: str | None) -> None:
    client, _ = make_client(packs=FakePacks())
    r = get(client, path, user)
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found", (user, r.text)


def test_the_flag_is_off_by_default_and_on_builds_the_runtime() -> None:
    from app.config import Settings
    from app.jobs.wiring import build_jobs

    assert build_jobs(Settings(_env_file=None, api_env="development")) is None  # type: ignore[call-arg]
    plain = build_jobs(Settings(_env_file=None, api_env="development", jobs="on"))  # type: ignore[call-arg]
    assert plain is not None and plain.get_paid is False and plain.directory is not None and (plain.directory / "festivals.json").is_file()
    got = build_jobs(Settings(_env_file=None, api_env="development", jobs="on", jobs_get_paid="on"))  # type: ignore[call-arg]
    assert got is not None and got.get_paid is True


# ------------------------------------------------------------------------------------------------------------------ the templates route
@pytest.mark.parametrize(("user", "status"), [("a_owner", 200), ("a_admin", 200), ("a_sales", 403), ("a_viewer", 403), ("outsider", 404), (None, 401)])
def test_templates_are_for_owner_and_admin(user: str | None, status: int) -> None:
    client, _ = make_client(jobs=on(), packs=FakePacks())
    assert get(client, TEMPLATES, user).status_code == status


def test_a_foreign_workspace_is_a_404() -> None:
    client, _ = make_client(jobs=on(), packs=FakePacks())
    assert get(client, f"/v1/tenants/{TENANT_B.id}/jobs/templates", "a_owner").status_code == 404


def test_the_answer_has_the_workspaces_own_templates_and_every_other_type_sorted_by_english_name() -> None:
    client, _ = make_client(jobs=on(), packs=FakePacks("textiles"))
    r = get(client, TEMPLATES)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["business_type"] == {"pack": "textiles", "name": {"en": "saree shops", "te": "చీరల షాపులు"}}
    assert body["own"]["pack"] == "textiles" and body["own"]["status"] == "draft" and body["own"]["version"] >= 1
    assert len(body["own"]["templates"]) >= 8
    packs_with_jobs = sorted(p.parent.name for p in PACKS.glob("*/jobs.json"))
    assert len(packs_with_jobs) == 54
    others = [o["pack"] for o in body["others"]]
    assert sorted(others) == [p for p in packs_with_jobs if p != "textiles"] and "textiles" not in others
    english = [packdata_names(PACKS, o) for o in others]
    assert english == sorted(english, key=str.casefold), "sorted by the pack's names.en"
    assert all(o["name"]["en"] and o["name"]["te"] for o in body["others"])
    assert all(len(o["jobs"]["templates"]) >= 8 for o in body["others"])


def packdata_names(directory: Path, pack_id: str) -> str:
    import json

    return str(json.loads((directory / pack_id / "pack.json").read_text(encoding="utf-8"))["names"]["en"])


def test_the_pack_comes_from_the_database_and_the_answer_follows_it() -> None:
    a, _ = make_client(jobs=on(), packs=FakePacks("clinic"))
    body = get(a, TEMPLATES).json()
    assert body["business_type"]["pack"] == "clinic" and body["own"]["pack"] == "clinic"
    assert [o["pack"] for o in body["others"]].count("clinic") == 0


def test_a_pack_without_a_names_file_still_gets_its_normal_names() -> None:
    client, _ = make_client(jobs=on(), packs=FakePacks("no_such_pack"))
    body = get(client, TEMPLATES).json()
    assert body["business_type"] == {"pack": "no_such_pack", "name": {"en": "Fake pack", "te": "ఫేక్"}}, "the pack's own names from the database row"
    assert body["own"]["templates"] == [] and len(body["others"]) == 54, "a pack whose templates cannot be read has none, the others are still shown"


def test_get_paid_templates_are_removed_while_the_flag_is_off() -> None:
    off, _ = make_client(jobs=on(), packs=FakePacks())
    body = get(off, TEMPLATES).json()
    assert [t for t in every_template(body) if t["goal"] == "get_paid"] == []
    for name in ("payment_reminder_gentle", "fee_reminder", "payment_step_reminder", "payment_due_reminder"):
        assert name not in {t["id"] for t in every_template(body)}
    full, _ = make_client(jobs=on(get_paid=True), packs=FakePacks())
    paid = [t for t in every_template(get(full, TEMPLATES).json()) if t["goal"] == "get_paid"]
    assert len(paid) == 54 and {"payment_reminder_gentle", "fee_reminder", "payment_step_reminder", "payment_due_reminder"} <= {t["id"] for t in paid}
    assert len(every_template(get(full, TEMPLATES).json())) - len(every_template(body)) == 54


def test_the_sample_item_is_the_first_active_item_as_written_and_absent_without_one() -> None:
    catalogue = FakeCatalogue("  Kanchipuram silk saree ")
    client, _ = make_client(jobs=on(), packs=FakePacks(), catalogue=cast(Any, catalogue))
    assert get(client, TEMPLATES).json()["sample"] == {"item": {"en": "Kanchipuram silk saree"}}
    assert catalogue.args[0]["p_include_inactive"] is False and catalogue.args[0]["p_limit"] == 1, "one active item"
    none, _ = make_client(jobs=on(), packs=FakePacks(), catalogue=cast(Any, FakeCatalogue(None)))
    assert "sample" not in get(none, TEMPLATES).json()
    unavailable, _ = make_client(jobs=on(), packs=FakePacks())
    assert "sample" not in get(unavailable, TEMPLATES).json()

    class Broken:
        def search(self, *a: Any, **k: Any) -> list[dict[str, Any]]:
            raise RuntimeError("module off")

    broken, _ = make_client(jobs=on(), packs=FakePacks(), catalogue=cast(Any, Broken()))
    assert get(broken, TEMPLATES).status_code == 200, "a refusal from the catalogue never fails the answer"


def test_a_template_keeps_the_shape_of_jobs_json_and_the_sample_audio_stays_null() -> None:
    client, _ = make_client(jobs=on(), packs=FakePacks())
    body = get(client, TEMPLATES).json()
    sending = [t for t in body["own"]["templates"] if t["kind"] != "researcher"]
    assert sending and all("preview" in t and t["preview"]["sample_audio"] is None and ("whatsapp" in t["preview"] or "call" in t["preview"]) for t in sending)
    assert all(set(t) >= {"id", "kind", "goal", "popular", "title", "benefit", "ask", "needs", "finds_out", "season"} for t in every_template(body))
    assert all("examples" not in t and "examples_real" not in t for t in sending)


def test_a_researcher_template_carries_the_workspaces_three_best_real_prospects() -> None:
    rows = [prospect("Lotus Sarees", fit=91), prospect("Peacock Boutique", "Old Town", 84, "Boutique", 3.9, 12), prospect("Silk Thread", "Station Road", 70, None, None, None), prospect("Fourth", fit=60)]
    finder = FakeLeadFinder(rows)
    client, _ = make_client(jobs=on(), packs=FakePacks(), lead_finder=finder)
    body = get(client, TEMPLATES).json()
    own = [t for t in body["own"]["templates"] if t["kind"] == "researcher"]
    assert len(own) == 1 and own[0]["examples_real"] is True and finder.asked == [3]
    assert own[0]["examples"] == [
        {"name": "Lotus Sarees", "area": "Market Road", "fit": 91, "why": {"code": "well_rated", "params": {"rating": "4.6", "count": 212}}},
        {"name": "Peacock Boutique", "area": "Old Town", "fit": 84, "why": {"code": "category_match", "params": {"category": "Boutique"}}},
        {"name": "Silk Thread", "area": "Station Road", "fit": 70},
    ]
    # the other business types never borrow this workspace's prospects
    other = [t for o in body["others"] for t in o["jobs"]["templates"] if t["kind"] == "researcher"]
    assert other and all(t["examples_real"] is False and all("fit" not in e for e in t["examples"]) for t in other)


@pytest.mark.parametrize("rows", [[], RuntimeError("lead finder off"), None])
def test_without_real_prospects_the_invented_examples_stand_with_no_fit(rows: Any) -> None:
    finder = FakeLeadFinder(rows) if rows is not None else None
    client, _ = make_client(jobs=on(), packs=FakePacks(), lead_finder=finder)
    researcher = [t for t in get(client, TEMPLATES).json()["own"]["templates"] if t["kind"] == "researcher"][0]
    assert researcher["examples_real"] is False and len(researcher["examples"]) == 3
    for e in researcher["examples"]:
        assert "fit" not in e and e["name"].endswith("(example)") and set(e["why"]) <= {"en", "te", "hi", "kn"} and e["why"]["en"]


def test_why_is_derived_only_from_stored_fields() -> None:
    assert why_of(prospect(rating=4.2, reviews=20)).model_dump() == {"code": "well_rated", "params": {"rating": "4.2", "count": 20}}  # type: ignore[union-attr]
    assert why_of(prospect(rating=4.1, reviews=500)).code == "category_match"  # type: ignore[union-attr]
    assert why_of(prospect(rating=4.9, reviews=19)).code == "category_match"  # type: ignore[union-attr]
    assert why_of(prospect(category="  ", rating=None, reviews=None)) is None
    assert why_of(prospect(category="x" * 90, rating=None, reviews=None)).params["category"] == "x" * 60  # type: ignore[union-attr]


def test_a_prospect_without_a_name_area_or_fit_is_not_an_example() -> None:
    from app.jobs.templates import real_examples

    assert real_examples([prospect(area=None), prospect(fit=None), prospect(name="")]) == []
    assert [e.fit for e in real_examples([prospect(fit=100)])] == [100]


def test_the_template_may_carry_its_own_sample_item(tmp_path: Path) -> None:
    import json
    import shutil

    shutil.copytree(PACKS / "textiles", tmp_path / "textiles")
    (tmp_path / "modules.json").write_text("{}", encoding="utf-8")
    data = json.loads((tmp_path / "textiles" / "jobs.json").read_text(encoding="utf-8"))
    data["templates"][0]["sample_item"] = {"en": "bridal silk sarees", "te": "బ్రైడల్ సిల్క్ చీరలు"}
    (tmp_path / "textiles" / "jobs.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    client, _ = make_client(jobs=JobsRuntime(directory=tmp_path, clock=clock()), packs=FakePacks())
    body = get(client, TEMPLATES).json()
    first = body["own"]["templates"][0]
    assert first["sample_item"] == {"en": "bridal silk sarees", "te": "బ్రైడల్ సిల్క్ చీరలు"}
    assert all("sample_item" not in t for t in body["own"]["templates"][1:])
    assert body["others"] == [], "a directory with only one pack has no others"


@pytest.mark.parametrize("bad", [{"en": "{item} sarees"}, {"en": "40 sarees"}, {"en": "bridal\nsarees"}, {"te": "చీరలు"}, {"en": "ok", "xx": "no"}])
def test_the_loader_refuses_a_bad_sample_item(bad: dict[str, str]) -> None:
    import json

    raw = json.loads((PACKS / "textiles" / "jobs.json").read_text(encoding="utf-8"))
    raw["templates"][0]["sample_item"] = bad
    with pytest.raises(packdata.JobsPackError):
        packdata.parse("textiles", raw)


def test_the_answer_has_an_etag_and_the_same_answer_is_a_304() -> None:
    client, _ = make_client(jobs=on(), packs=FakePacks())
    first = get(client, TEMPLATES)
    etag = first.headers["etag"]
    assert etag.startswith('"') and etag.endswith('"') and first.headers["cache-control"] == "private, no-cache"
    again = get(client, TEMPLATES, **{"If-None-Match": etag})
    assert again.status_code == 304 and again.content == b"" and again.headers["etag"] == etag
    assert get(client, TEMPLATES, **{"If-None-Match": f"W/{etag}"}).status_code == 304
    assert get(client, TEMPLATES, **{"If-None-Match": f'"other", {etag}'}).status_code == 304
    assert get(client, TEMPLATES, **{"If-None-Match": "*"}).status_code == 304
    stale = get(client, TEMPLATES, **{"If-None-Match": '"stale"'})
    assert stale.status_code == 200 and stale.headers["etag"] == etag
    # a different answer has a different tag
    other, _ = make_client(jobs=on(), packs=FakePacks(), catalogue=cast(Any, FakeCatalogue("Mysore silk")))
    assert get(other, TEMPLATES).headers["etag"] != etag
    # a caller without the right is refused before the tag matters
    assert get(client, TEMPLATES, "a_sales", **{"If-None-Match": etag}).status_code == 403


# ------------------------------------------------------------------------------------------------------------------ the festivals route
@pytest.mark.parametrize(("user", "status"), [("a_owner", 200), ("a_admin", 200), ("a_sales", 200), ("a_viewer", 200), ("outsider", 404), (None, 401)])
def test_festivals_are_for_every_member(user: str | None, status: int) -> None:
    client, _ = make_client(jobs=on())
    assert get(client, FESTIVALS, user).status_code == status


def dates(body: dict[str, Any]) -> list[tuple[str, str]]:
    return [(i["season"], i["date"]) for i in body["items"]]


def test_the_next_sixty_days_nearest_first_one_row_per_season() -> None:
    client, _ = make_client(jobs=on(), business_profile=FakeProfile())
    body = get(client, FESTIVALS).json()
    assert body["region"] == "india"
    # 19 Nov 2026: Diwali (8 Nov) is past, the next one is a year away; the season starts 20 Nov; New Year is 43 days off
    assert dates(body) == [("wedding_season", "2026-11-20"), ("new_year", "2027-01-01")]
    assert all(i["region"] == "india" and i["name"]["en"] and i["name"]["te"] for i in body["items"])


def test_the_window_is_sixty_days_today_included() -> None:

    def at(text: str) -> Any:
        return make_client(jobs=on(clock=clock(text)), business_profile=FakeProfile())[0]

    assert dates(get(at("2026-11-02T12:00:00+00:00"), FESTIVALS).json()) == [("diwali", "2026-11-08"), ("wedding_season", "2026-11-20"), ("new_year", "2027-01-01")]
    # 1 Jan today is "today"; 61 days before it is outside
    assert ("new_year", "2027-01-01") in dates(get(at("2027-01-01T05:00:00+00:00"), FESTIVALS).json())
    assert ("new_year", "2027-01-01") in dates(get(at("2026-11-02T00:00:00+00:00"), FESTIVALS).json()), "60 days ahead is inside"
    assert ("new_year", "2027-01-01") not in dates(get(at("2026-11-01T00:00:00+00:00"), FESTIVALS).json()), "61 days ahead is outside"
    assert get(at("2027-02-01T12:00:00+00:00"), FESTIVALS).json()["items"] == [], "nothing in the next 60 days is an empty list, not an error"


def test_today_is_the_indian_day() -> None:
    # 20:00 UTC on 19 Nov is 01:30 on 20 Nov in India: the season that starts on the 20th is today
    client, _ = make_client(jobs=on(clock=clock("2026-11-19T20:00:00+00:00")), business_profile=FakeProfile())
    assert ("wedding_season", "2026-11-20") in dates(get(client, FESTIVALS).json())
    late, _ = make_client(jobs=on(clock=clock("2026-11-20T20:00:00+00:00")), business_profile=FakeProfile())
    assert ("wedding_season", "2026-11-20") not in dates(get(late, FESTIVALS).json()), "21 Nov in India: the 20th is past"


@pytest.mark.parametrize(
    ("state_code", "region", "wedding"),
    [("36", "telangana", "2026-11-21"), ("37", "andhra", "2026-11-21"), ("28", "andhra", "2026-11-21"), ("29", "karnataka", "2026-11-21"), ("27", "india", "2026-11-20"), ("07", "india", "2026-11-20")],
)
def test_the_region_comes_from_the_profile_state(state_code: str, region: str, wedding: str) -> None:
    client, _ = make_client(jobs=on(), business_profile=FakeProfile(gstin_of(state_code)))
    body = get(client, FESTIVALS).json()
    assert body["region"] == region and ("wedding_season", wedding) in dates(body)
    assert all(i["region"] == region for i in body["items"])


@pytest.mark.parametrize("profile", [FakeProfile(None), FakeProfile("not a gstin"), FakeProfile(error=RuntimeError("down")), None])
def test_no_state_or_an_unreadable_profile_is_india(profile: Any) -> None:
    client, _ = make_client(jobs=on(), business_profile=profile)
    r = get(client, FESTIVALS)
    assert r.status_code == 200 and r.json()["region"] == "india"


def test_a_missing_calendar_is_an_empty_answer(tmp_path: Path) -> None:
    (tmp_path / "modules.json").write_text("{}", encoding="utf-8")
    client, _ = make_client(jobs=JobsRuntime(directory=tmp_path, clock=clock()), business_profile=FakeProfile())
    assert get(client, FESTIVALS).json() == {"region": "india", "items": []}
