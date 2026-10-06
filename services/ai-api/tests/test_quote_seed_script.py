"""The synthetic-data seed script (T009): local only, a validated slug, no secret, nothing but the operator function."""

from __future__ import annotations

from pathlib import Path

import pytest

from seeds import seed_quote_reference_data as seed


@pytest.mark.parametrize(
    "url", ["http://127.0.0.1:54321", "http://localhost:54321", "http://[::1]:54321"]
)
def test_local_urls_are_accepted(url: str) -> None:
    assert seed.is_local(url)


@pytest.mark.parametrize(
    "url",
    [
        "https://abc.supabase.co",
        "http://10.0.0.5:54321",
        "http://127.0.0.1.evil.test",
        "http://localhost.evil.test",
        "",
    ],
)
def test_everything_else_is_refused(url: str) -> None:
    assert not seed.is_local(url)


def test_the_script_refuses_a_hosted_url_without_touching_docker(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("SUPABASE_URL", "https://abc.supabase.co")
    monkeypatch.setattr(
        "seeds.seed_quote_reference_data.subprocess.run",
        lambda *a, **k: pytest.fail("docker must not run"),
    )
    assert seed.main(["--tenant-slug", "demo"]) == 2
    assert "LOCAL" in capsys.readouterr().err


@pytest.mark.parametrize("slug", ["demo", "tenant-a", "a1"])
def test_a_valid_slug_becomes_the_one_statement(slug: str) -> None:
    assert seed.seed_sql(slug) == f"select app.operator_seed_quote_reference_data('{slug}')"


@pytest.mark.parametrize(
    "slug", ["", "Demo", "a'; drop table products; --", "a b", "-a", "a" * 64, "a;b"]
)
def test_an_invalid_slug_is_refused(slug: str) -> None:
    with pytest.raises(ValueError):
        seed.seed_sql(slug)


def test_the_container_name_comes_from_the_project_id() -> None:
    assert seed.container_name('project_id = "sme-ai"\n') == "supabase_db_sme-ai"
    with pytest.raises(ValueError):
        seed.container_name("name = 'x'")


def test_the_script_reads_no_secret_and_runs_only_the_operator_function() -> None:
    source = Path(seed.__file__).read_text()
    assert (
        "service_role" not in source
        and "dotenv" not in source
        and "SERVICE_ROLE" not in source
        and "open(" not in source
    )
    assert (
        source.count("select app.") == 1
    )  # the one statement it runs, built by seed_sql from a validated slug
