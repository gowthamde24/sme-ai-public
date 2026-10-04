"""`make seed-demo` is the T004 acceptance test: "a synthetic SME can be represented end-to-end and
every researched fact can carry evidence". Run here against the real stack with the real
application, as the demo user; then a second user in another workspace proves none of it leaks."""

# ruff: noqa: E501, S608  (test code: long messages; SQL built from ids we generate ourselves)

from __future__ import annotations

import importlib.util
import re
import sys
from pathlib import Path
from typing import Any

import httpx
import pytest
from conftest import Stack, User, bearer
from evidence_support import check_schema, pg, uid
from fastapi.testclient import TestClient

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "seed_demo.py"
spec = importlib.util.spec_from_file_location("seed_demo", SCRIPT)
assert spec and spec.loader
seed: Any = importlib.util.module_from_spec(spec)
sys.modules["seed_demo"] = seed  # dataclasses look the module up by name
spec.loader.exec_module(seed)

NOT_A_NETWORK = httpx.Client(
    transport=httpx.MockTransport(lambda r: pytest.fail("the seed made a network call"))
)


def config(stack: Stack, **over: str) -> Any:
    values = {
        "supabase_url": stack.url,
        "anon_key": stack.anon_key,
        "api_url": "http://localhost:8000",
    }
    return seed.Config(**{**values, **over})


@pytest.fixture(scope="module")
def demo(stack: Stack, client: TestClient) -> Any:
    """Run the seed twice (the second run must change nothing) and keep both summaries."""
    http = httpx.Client()
    first = seed.run(config(stack), api=client, http=http)
    second = seed.run(config(stack), api=client, http=http)
    return first, second


def demo_token(stack: Stack) -> User:
    r = httpx.post(
        f"{stack.url}/auth/v1/token?grant_type=password",
        headers={"apikey": stack.anon_key},
        json={"email": seed.DEMO_EMAIL, "password": seed.DEMO_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200
    body = r.json()
    import uuid

    return User(label="demo", id=uuid.UUID(body["user"]["id"]), token=body["access_token"])


# ==== safety ====
@pytest.mark.parametrize(
    "over",
    [
        {"supabase_url": "https://abcdefgh.supabase.co"},
        {"supabase_url": "http://127.0.0.1.evil.example:54321"},
        {"supabase_url": "http://localhost.evil.example"},
        {"supabase_url": "http://evil.example/127.0.0.1"},
        {"supabase_url": "ftp://127.0.0.1"},
        {"supabase_url": "not a url"},
        {"api_url": "https://api.example.com"},
        {"api_url": "http://10.0.0.5:8000"},
        {"api_url": "http://0.0.0.0:8000"},
    ],
)
def test_it_refuses_anything_but_a_local_stack_before_any_network_call(
    stack: Stack, over: dict[str, str]
) -> None:
    with pytest.raises(seed.SeedError, match="Refusing to run"):
        seed.run(config(stack, **over), api=NOT_A_NETWORK, http=NOT_A_NETWORK)


@pytest.mark.parametrize(
    "url", ["http://127.0.0.1:54321", "http://localhost:8000", "http://[::1]:8000"]
)
def test_local_hosts_are_accepted(url: str) -> None:
    seed.require_local(url, "URL")


def test_a_missing_anon_key_is_a_readable_error_not_a_crash(stack: Stack) -> None:
    http = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(500)))
    with pytest.raises(seed.SeedError, match="SUPABASE_ANON_KEY"):
        seed.run(config(stack, anon_key=""), api=http, http=http)


def test_the_script_never_prints_or_repr_the_keys_and_has_no_service_role_key(
    stack: Stack, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    cfg = config(stack)
    assert stack.anon_key not in repr(cfg)
    summary = seed.Summary("t", "c", "l", claims=1, claim_links={"k": 1}, stances={"supports"})
    monkeypatch.setattr(seed, "load_config", lambda: cfg)
    monkeypatch.setattr(seed, "run", lambda c: summary)
    assert seed.main() == 0
    printed = capsys.readouterr()
    assert stack.anon_key not in printed.out + printed.err
    text = SCRIPT.read_text()
    assert not re.search(r"SERVICE_ROLE|SUPABASE_SERVICE|service_role|JWT_SECRET", text)
    assert "OWN JWT" in text and "NO service-role key" in text, (
        "the header says how claims are written"
    )


def test_failures_print_a_message_without_secrets(
    stack: Stack, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    def boom(c: Any) -> None:
        raise seed.SeedError("Could not create the demo company (HTTP 500).")

    monkeypatch.setattr(seed, "load_config", lambda: config(stack))
    monkeypatch.setattr(seed, "run", boom)
    assert seed.main() == 1
    err = capsys.readouterr().err
    assert "Could not create" in err and stack.anon_key not in err


def test_config_prefers_the_environment_and_reads_only_what_it_needs(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text(
        "SUPABASE_URL=http://127.0.0.1:1\nSUPABASE_ANON_KEY=from-file\n"
        "OTHER_SECRET=nope\n# SUPABASE_URL=x\n"
    )
    assert seed._read_env_file(env_file, {"SUPABASE_URL", "SUPABASE_ANON_KEY"}) == {
        "SUPABASE_URL": "http://127.0.0.1:1",
        "SUPABASE_ANON_KEY": "from-file",
    }
    assert seed._read_env_file(tmp_path / "missing", {"A"}) == {}
    cfg = seed.load_config(
        {
            "SUPABASE_URL": "http://localhost:9",
            "SUPABASE_ANON_KEY": "k",
            "SEED_API_URL": "http://localhost:1/",
        }
    )
    assert (cfg.supabase_url, cfg.anon_key, cfg.api_url) == (
        "http://localhost:9",
        "k",
        "http://localhost:1",
    )


def test_the_seeds_own_acceptance_check_fails_loudly_for_a_claim_without_evidence(
    stack: Stack,
) -> None:
    seeder = seed.Seeder(config(stack), NOT_A_NETWORK, NOT_A_NETWORK)
    seeder.summary = seed.Summary("t", "c", "l")
    complete = [{"claim_id": seed.demo_id(key), "stance": "supports"} for key, *_ in seed.CLAIMS]
    seeder._rest_get = lambda path: complete[:-1]  # the last claim has no link
    with pytest.raises(seed.SeedError, match="has no evidence"):
        seeder.verify()


def test_a_run_ends_with_the_acceptance_check(
    stack: Stack, client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    def probe(self: Any) -> None:
        raise seed.SeedError("Acceptance failed: probe")

    monkeypatch.setattr(seed.Seeder, "verify", probe)
    with pytest.raises(seed.SeedError, match="probe"):
        seed.run(config(stack), api=client, http=httpx.Client())


# ==== the acceptance test ====
def test_the_second_run_creates_nothing_new(demo: Any) -> None:
    first, second = demo
    assert second.created == 0, "re-running must not duplicate anything"
    assert second.reused == first.created + first.reused
    assert (first.tenant_id, first.company_id, first.lead_id) == (
        second.tenant_id,
        second.company_id,
        second.lead_id,
    )


def test_a_synthetic_sme_is_represented_end_to_end(
    demo: Any, stack: Stack, client: TestClient
) -> None:
    summary, _ = demo
    user = demo_token(stack)
    base = f"/v1/tenants/{summary.tenant_id}"
    seeded = {
        "companies": ["company"],
        "contacts": ["contact-asha", "contact-ravi", "contact-mei"],
        "products": ["product-1", "product-2", "product-3"],
        "leads": ["lead"],
        "opportunities": ["opportunity"],
    }
    for entity, keys in seeded.items():
        r = client.get(f"{base}/{entity}", headers=bearer(user), params={"limit": 100})
        assert r.status_code == 200, entity
        items = r.json()["items"]
        by_id = {item["id"]: item for item in items}
        for key in keys:  # the seeded rows are there (someone may have added more since)
            item = by_id.get(seed.demo_id(key))
            assert item is not None, f"{entity}: {key} is missing"
            label = (
                item.get("name") or item.get("full_name") or item.get("title") or item.get("source")
            )
            assert str(label).startswith("DEMO"), f"{entity}: not obviously fake: {label}"
            assert item["created_via"] == "manual"
            assert not item.get("email") or item["email"].endswith("@demo.example.test"), (
                "only reserved domains"
            )


def test_every_claim_has_evidence_and_one_contradicts(demo: Any, stack: Stack) -> None:
    summary, _ = demo
    user = demo_token(stack)
    claims = pg(
        stack,
        user,
        "GET",
        f"/claims?tenant_id=eq.{summary.tenant_id}&created_via=eq.manual"
        "&select=id,predicate,confidence,company_id,lead_id",
    )
    assert claims.status_code == 200
    rows = claims.json()
    assert len(rows) == 4 == summary.claims  # the seed's own, hand-written claims
    assert {r["confidence"] for r in rows} >= {"low", "medium", "unverified"}
    assert (
        sum(1 for r in rows if r["lead_id"]) == 1 and sum(1 for r in rows if r["company_id"]) == 3
    )
    links = pg(
        stack,
        user,
        "GET",
        f"/evidence_links?tenant_id=eq.{summary.tenant_id}&claim_id=not.is.null&created_via=eq.manual"
        "&select=claim_id,evidence_id,stance",
    )
    per_claim: dict[str, list[str]] = {}
    for link in links.json():
        per_claim.setdefault(link["claim_id"], []).append(link["stance"])
    for row in rows:
        assert per_claim.get(row["id"]), f"claim {row['predicate']} has no evidence"
    assert any("contradicts" in stances for stances in per_claim.values())
    assert {"supports", "contradicts", "context"} <= {s for st in per_claim.values() for s in st}
    # every claim link points at evidence that the API itself lists for the company or the lead
    evidence_ids = {link["evidence_id"] for link in links.json()}
    listed: set[str] = set()
    for column, target in (("company_id", summary.company_id), ("lead_id", summary.lead_id)):
        r = pg(
            stack,
            user,
            "GET",
            f"/evidence_links?tenant_id=eq.{summary.tenant_id}&{column}=eq.{target}&select=evidence_id",
        )
        listed |= {row["evidence_id"] for row in r.json()}
    assert evidence_ids <= listed


def test_the_evidence_appears_through_the_api_for_the_company_and_the_lead(
    demo: Any, stack: Stack, client: TestClient
) -> None:
    summary, _ = demo
    user = demo_token(stack)
    base = f"/v1/tenants/{summary.tenant_id}"
    company = client.get(
        f"{base}/companies/{summary.company_id}/evidence",
        headers=bearer(user),
        params={"limit": 100},
    )
    lead = client.get(
        f"{base}/leads/{summary.lead_id}/evidence", headers=bearer(user), params={"limit": 100}
    )
    assert company.status_code == lead.status_code == 200
    check_schema(company.json(), "Page_EvidenceLinkOut_")
    check_schema(lead.json(), "Page_EvidenceLinkOut_")
    assert summary.company_evidence == 4 and summary.lead_evidence == 2
    for page, keys in (
        (company, [k for k, *_ in seed.COMPANY_EVIDENCE]),
        (lead, [k for k, *_ in seed.LEAD_EVIDENCE]),
    ):
        by_id = {item["evidence"]["id"]: item for item in page.json()["items"]}
        for key in keys:  # every seeded evidence row is listed (someone may have added more since)
            e = by_id[seed.demo_id(key)]["evidence"]
            assert e["provider"] == "manual" and e["created_via"] == "manual"
            assert (e["snippet"] or "").startswith("DEMO"), "every seeded snippet is obviously fake"
            if e["url"]:
                assert "demo.example.test" in e["url"]


def test_a_second_user_in_another_workspace_sees_none_of_it(
    demo: Any, stack: Stack, client: TestClient, signup: Any
) -> None:
    summary, _ = demo
    other = signup("seed-outsider")
    created = client.post(
        "/v1/tenants",
        json={"name": "Not the demo", "slug": f"outsider-{uid()[:8]}"},
        headers=bearer(other),
    )
    assert created.status_code == 200
    mine = created.json()["id"]
    base = f"/v1/tenants/{summary.tenant_id}"
    h = bearer(other)
    for path in (
        base,
        f"{base}/companies",
        f"{base}/companies/{summary.company_id}",
        f"{base}/companies/{summary.company_id}/evidence",
        f"{base}/leads/{summary.lead_id}/evidence",
    ):
        assert client.get(path, headers=h).status_code == 404, path
    # the demo company's id through the outsider's OWN workspace path is also a 404
    assert (
        client.get(f"/v1/tenants/{mine}/companies/{summary.company_id}", headers=h).status_code
        == 404
    )
    assert (
        client.get(
            f"/v1/tenants/{mine}/companies/{summary.company_id}/evidence", headers=h
        ).status_code
        == 404
    )
    assert (
        client.post(
            f"/v1/tenants/{mine}/companies/{summary.company_id}/evidence",
            headers=h,
            json={"id": uid(), "kind": "note", "reference": "doc:x1"},
        ).status_code
        == 404
    )
    # straight at the data layer: nothing of the demo tenant is visible
    for table in (
        "claims",
        "evidence",
        "evidence_links",
        "companies",
        "contacts",
        "products",
        "leads",
        "opportunities",
    ):
        r = pg(stack, other, "GET", f"/{table}?tenant_id=eq.{summary.tenant_id}&select=id")
        assert r.status_code == 200 and r.json() == [], table
        everything = pg(stack, other, "GET", f"/{table}?select=tenant_id&limit=1000")
        assert summary.tenant_id not in {row["tenant_id"] for row in everything.json()}, table
    # and a write into it is refused
    forged = pg(
        stack,
        other,
        "POST",
        "/claims",
        json={
            "id": uid(),
            "tenant_id": summary.tenant_id,
            "company_id": summary.company_id,
            "predicate": "exports_to",
            "value": "x",
            "confidence": "low",
        },
    )
    assert forged.status_code in (401, 403)


# ==== T005 fix round F / G: the ICP profile and the 20-lead walkthrough ====
TEMPLATE_FILE = Path(__file__).resolve().parents[2] / "config" / "icp" / "silk-wholesale.v1.json"


def test_the_template_is_the_active_icp_version_and_rerunning_publishes_nothing(
    demo: Any, stack: Stack, client: TestClient
) -> None:
    import json

    summary, second = demo
    user = demo_token(stack)
    base = f"/v1/tenants/{summary.tenant_id}"
    template = json.loads(TEMPLATE_FILE.read_text(encoding="utf-8"))
    active = client.get(f"{base}/icp-configs/active", headers=bearer(user))
    assert active.status_code == 200
    assert active.json()["config"] == template
    assert active.json()["id"] == summary.icp_version_id == second.icp_version_id
    versions = client.get(f"{base}/icp-configs", headers=bearer(user), params={"limit": 100})
    before = [v["id"] for v in versions.json()["items"]]
    assert active.json()["id"] in before and active.json()["created_via"] == "manual"
    # a third run, here and now: still no new version
    third = seed.run(config(stack), api=client, http=httpx.Client())
    assert third.icp_version_id == active.json()["id"] and third.created == 0
    after = client.get(f"{base}/icp-configs", headers=bearer(user), params={"limit": 100})
    assert [v["id"] for v in after.json()["items"]] == before


def test_a_changed_template_is_a_new_version_and_an_old_version_is_never_edited(
    stack: Stack, client: TestClient
) -> None:
    """On a throwaway workspace of the demo user (the demo workspace itself stays as seeded)."""
    user = demo_token(stack)
    made = client.post(
        "/v1/tenants",
        json={"name": "DEMO scratch (fictional)", "slug": f"demo-scratch-{uid()[:8]}"},
        headers=bearer(user),
    )
    assert made.status_code == 200
    tenant = made.json()["id"]
    base = f"/v1/tenants/{tenant}"
    seeder = seed.Seeder(config(stack), client, httpx.Client())
    seeder.token, seeder.summary = user.token, seed.Summary(tenant, "", "")

    def versions() -> list[Any]:
        r = client.get(f"{base}/icp-configs", headers=bearer(user), params={"limit": 100})
        return list(r.json()["items"])

    seeder.icp()
    seeder.icp()  # unchanged template: a no-op
    assert [v["version_no"] for v in versions()] == [1]
    original = seeder.template()
    changed = {
        **original,
        "human_labels_override_score": not original["human_labels_override_score"],
    }
    seeder.template = lambda: changed
    seeder.icp()
    assert [v["version_no"] for v in versions()] == [2, 1], "newest first; version 1 stays"
    assert versions()[1]["config"] == original
    seeder.template = lambda: original
    seeder.icp()  # the ACTIVE one differs from the template again: version 3
    final = client.get(f"{base}/icp-configs/active", headers=bearer(user)).json()
    assert final["version_no"] == 3 and final["config"] == original


def queue_items(client: TestClient, user: User, tenant_id: str, **params: str) -> list[Any]:
    items: list[Any] = []
    cursor: str | None = None
    while True:
        query = {"limit": "100", **params, **({"cursor": cursor} if cursor else {})}
        r = client.get(
            f"/v1/tenants/{tenant_id}/leads/review-queue", headers=bearer(user), params=query
        )
        assert r.status_code == 200, r.text
        items += r.json()["items"]
        cursor = r.json()["next_cursor"]
        if not cursor:
            return items


def test_twenty_synthetic_leads_are_ready_for_the_walkthrough(
    demo: Any, stack: Stack, client: TestClient
) -> None:
    summary, second = demo
    assert len(seed.DEMO_LEADS) == 20
    assert summary.leads_imported == 20 and second.leads_imported == 20
    user = demo_token(stack)
    items = queue_items(client, user, summary.tenant_id, blind="false")
    names = {i["company"]["name"]: i for i in items}
    for row in seed.DEMO_LEADS:
        assert row["company_name"] in names, f"{row['company_name']} is not in the review queue"
    imported = [names[row["company_name"]] for row in seed.DEMO_LEADS]
    assert len({i["lead_id"] for i in imported}) == 20
    assert all(i["status"] == "new" and i["score"] is not None for i in imported)
    assert all(i["latest_label"] is None for i in imported), "nothing is pre-labelled"
    assert len({i["score_band"] for i in imported}) >= 3, "a spread of bands to review"
    # the blind view (the default) shows none of those scores
    blind = {i["lead_id"]: i for i in queue_items(client, user, summary.tenant_id)}
    assert all(blind[i["lead_id"]]["score"] is None for i in imported)


def test_the_synthetic_leads_cover_the_cases_a_reviewer_must_see() -> None:
    rows = seed.DEMO_LEADS
    cities = {str(r.get("city")) for r in rows}
    assert {"Bengaluru", "Dharmavaram", "Chennai"} <= cities
    text = " ".join(str(r.get("industry", "")) + " " + r["company_name"] for r in rows).lower()
    assert "silk" in text and "hardware" in text, "silk businesses and clearly non-silk ones"
    assert any("not a business" in r["company_name"].lower() for r in rows), "non-business rows"
    assert any("contact_email" in r for r in rows) and any("contact_email" not in r for r in rows)


def test_the_synthetic_leads_contain_nothing_real() -> None:
    import re

    for row in seed.DEMO_LEADS:
        assert row["company_name"].startswith("DEMO "), row["company_name"]
        website = row.get("website")
        assert website is None or re.fullmatch(
            r"https://[a-z0-9.-]+\.test(/[a-z0-9/-]*)?", website
        ), website
        if "contact_email" in row:
            assert row["contact_email"].endswith(".test"), row["contact_email"]
            assert row["contact_name"].startswith("DEMO "), row["contact_name"]
            assert row["contact_phone"].startswith("+00 "), row["contact_phone"]
        assert str(row.get("source", "DEMO")).startswith("DEMO")
        assert not re.search(r"\b(gmail|yahoo|hotmail|outlook)\b", str(row), re.I)
        assert not re.search(r"\+91|\b[6-9]\d{9}\b", str(row)), "no real-looking phone number"


def test_every_synthetic_lead_passes_the_real_data_gate_and_the_import_is_a_replay_on_rerun(
    demo: Any, stack: Stack, client: TestClient
) -> None:
    summary, _ = demo
    user = demo_token(stack)
    base = f"/v1/tenants/{summary.tenant_id}"
    again = client.post(
        f"{base}/leads/import/preview",
        headers=bearer(user),
        json={"batch_id": uid(), "rows": seed.DEMO_LEADS},
    )
    assert again.status_code == 200
    outcomes = {row["outcome"] for row in again.json()["rows"]}
    assert outcomes == {"skipped_duplicate"}, "all 20 already exist as open leads"
    assert not any(
        row.get("reason") == "contact_domain_not_reserved" for row in again.json()["rows"]
    )
    # imported attributes carry their provenance: claims linked to the batch evidence
    claims = pg(
        stack,
        user,
        "GET",
        f"/claims?tenant_id=eq.{summary.tenant_id}&created_via=eq.import&select=id",
    ).json()
    assert claims, "the attribute columns became claims"
    links = pg(
        stack,
        user,
        "GET",
        f"/evidence_links?tenant_id=eq.{summary.tenant_id}&created_via=eq.import&select=claim_id",
    ).json()
    assert {c["id"] for c in claims} == {link["claim_id"] for link in links}


# ==== T006 (c): selftest is enabled for the DEMO workspace ONLY, by the local dev script ====
DEV_SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "dev-enable-selftest.sh"


def test_the_dev_script_is_local_only_and_uses_no_key() -> None:
    text = DEV_SCRIPT.read_text()
    assert "docker exec" in text and "app.operator_enable_selftest" in text
    assert not re.search(r"SERVICE_ROLE|service_role|JWT_SECRET|supabase\.co|https?://", text), (
        "no key and no network address"
    )
    assert "demo-synthetic-sme" in (Path(__file__).resolve().parents[2] / "Makefile").read_text(), (
        "make seed-demo calls it for the DEMO workspace"
    )
    assert seed.DEMO_WORKSPACE_SLUG == "demo-synthetic-sme"


def test_the_dev_script_enables_selftest_for_the_demo_workspace_and_nobody_else(
    demo: Any, stack: Stack, client: TestClient
) -> None:
    import subprocess

    import operator_sql

    summary, _ = demo
    saved = operator_sql.snapshot_switches()
    user = demo_token(stack)
    try:
        operator_sql.sql(
            "update public.platform_flags set enabled = false; "  # noqa: S608
            "update public.agent_definitions set allowed_tenants = '{}' "
            "where agent_name = 'selftest'; "
            f"delete from public.tenant_agent_settings where tenant_id = '{summary.tenant_id}'"
        )
        bad = subprocess.run(  # noqa: S603 - our own script, fixed argv
            [str(DEV_SCRIPT), "x'; drop table public.tenants; --"],
            capture_output=True,
            text=True,
            cwd=DEV_SCRIPT.parent.parent,
        )
        assert bad.returncode == 2, "a slug with SQL metacharacters is refused before anything runs"
        unknown = subprocess.run(  # noqa: S603 - our own script, fixed argv
            [str(DEV_SCRIPT), "no-such-workspace"],
            capture_output=True,
            text=True,
            cwd=DEV_SCRIPT.parent.parent,
        )
        assert unknown.returncode != 0
        assert (
            operator_sql.sql("select string_agg(enabled::text, ',') from public.platform_flags")
            == "false,false"
        ), "an unknown slug changed nothing"

        done = subprocess.run(  # noqa: S603 - our own script, fixed argv
            [str(DEV_SCRIPT), seed.DEMO_WORKSPACE_SLUG],
            capture_output=True,
            text=True,
            cwd=DEV_SCRIPT.parent.parent,
        )
        assert done.returncode == 0, done.stderr
        assert (
            operator_sql.sql("select string_agg(enabled::text, ',') from public.platform_flags")
            == "true,true"
        )
        allowed = operator_sql.sql(
            "select array_to_string(allowed_tenants, ',') from public.agent_definitions "
            "where agent_name = 'selftest'"
        )
        assert allowed == summary.tenant_id, "the allow-list holds exactly the DEMO workspace"
        r = pg(
            stack,
            user,
            "GET",
            f"/tenant_agent_settings?tenant_id=eq.{summary.tenant_id}&select=enabled",
        )
        assert r.json() == [{"enabled": True}]
        # and the demo user (an Owner) can now start a selftest run; a second workspace cannot
        started = pg(
            stack,
            user,
            "POST",
            "/rpc/start_agent_run",
            json={
                "p_run_id": uid(),
                "p_tenant_id": summary.tenant_id,
                "p_agent_name": "selftest",
                "p_agent_version": "dev-seed",
                "p_target_kind": "company",
                "p_target_id": summary.company_id,
                "p_input_sha256": "d" * 64,
            },
        )
        assert started.status_code == 200, started.text
        pg(
            stack,
            user,
            "POST",
            "/rpc/cancel_agent_run",
            json={"p_run_id": started.json()["run_id"]},
        )
        again = subprocess.run(  # noqa: S603 - our own script, fixed argv
            [str(DEV_SCRIPT), seed.DEMO_WORKSPACE_SLUG],
            capture_output=True,
            text=True,
            cwd=DEV_SCRIPT.parent.parent,
        )
        assert again.returncode == 0
        assert (
            operator_sql.sql(
                "select cardinality(allowed_tenants) from public.agent_definitions "
                "where agent_name = 'selftest'"
            )
            == "1"
        ), "idempotent"
    finally:
        operator_sql.restore_switches(saved)


# ==== the agent walkthrough step (T006): a smoke test ====
def test_the_agent_step_refuses_a_non_local_stack(stack: Stack) -> None:
    with pytest.raises(seed.SeedError, match="not on this machine"):
        seed.run_agents(
            config(stack, api_url="https://api.example.com"), api=NOT_A_NETWORK, http=NOT_A_NETWORK
        )


def test_the_agent_step_says_how_to_enable_agents_when_the_api_has_them_off(
    stack: Stack, client: TestClient, demo: Any
) -> None:
    with pytest.raises(seed.SeedError, match="AGENTS_ENABLED=true"):
        seed.run_agents(config(stack), api=client, http=httpx.Client())


def test_the_agent_step_runs_one_selftest_run_on_the_demo_company_and_a_second_call_replays_it(
    stack: Stack, demo: Any
) -> None:
    import operator_sql
    from fastapi.testclient import TestClient as AppClient

    from app.config import Settings
    from app.main import build_runtime, create_app

    first, _ = demo
    saved = operator_sql.snapshot_switches()
    operator_sql.sql(f"select app.operator_enable_selftest('{seed.DEMO_WORKSPACE_SLUG}')")
    settings = Settings(  # type: ignore[call-arg]
        _env_file=None,
        api_env="development",
        supabase_url=stack.url,
        supabase_anon_key=stack.anon_key,
        agents_enabled=True,
        llm_provider="fake",
    )
    try:
        with AppClient(create_app(settings, runtime=build_runtime(settings))) as agents_client:
            summary, status = seed.run_agents(config(stack), api=agents_client, http=httpx.Client())
            assert status == "succeeded" and summary.tenant_id == first.tenant_id
            again_summary, again_status = seed.run_agents(
                config(stack), api=agents_client, http=httpx.Client()
            )
            assert again_status == "succeeded"
            runs = operator_sql.sql(
                f"select count(*) from public.agent_runs where id = '{seed.demo_id('agent-run-selftest')}'"
            )
            assert runs == "1", "a second call replays the same run"
            claims = operator_sql.sql(
                f"select count(*) from public.claims where created_via = 'agent' and company_id = '{summary.company_id}' and agent_run_id = '{seed.demo_id('agent-run-selftest')}'"
            )
            assert claims == "2"
    finally:
        operator_sql.restore_switches(saved)


# ==== the kill-switch runbook (T006): its SQL must run against the real schema ====
def test_every_sql_block_of_the_kill_switch_runbook_runs_against_the_real_schema() -> None:
    """A smoke test: each fenced sql block is executed inside a transaction that is rolled back, with the placeholders filled in
    from the demo workspace, so a renamed column or table breaks the build instead of the operator at 3 a.m."""
    import operator_sql

    runbook = (
        Path(__file__).resolve().parents[2] / "docs" / "runbooks" / "agents-kill-switch.md"
    ).read_text()
    blocks = re.findall(r"```sql\n(.*?)```", runbook, re.S)
    assert len(blocks) >= 7, "the three levels, their verifications and the listing"
    slug = seed.DEMO_WORKSPACE_SLUG
    for block in blocks:
        statement = block.replace(":RUN_ID", "00000000-0000-4000-8000-000000000000").replace(
            ":SLUG", slug
        )
        out = operator_sql.sql(f"begin; {statement} rollback;")
        assert "ERROR" not in out
