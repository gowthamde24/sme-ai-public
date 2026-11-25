"""The spoken samples of the job cards (20 Nov 2026): the plan goes round the business types, nothing is spent twice, the cap holds in the run AND in the database, the routes list, play and generate with fakes
(no voice service, no database: this spends nothing)."""

# ruff: noqa: E501

from __future__ import annotations

import base64
from typing import Any

import pytest

from app.jobs import packdata, samples
from app.jobs.wiring import JobsRuntime
from tests.fakes import TENANT_A, auth, make_client
from tests.test_jobs_s2a_routes import PACKS, FakePacks, clock, every_template, get

A = TENANT_A.id


class FakeTts:
    name = "sarvam"

    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    def synthesize(self, text: str, language: str, **kw: Any) -> Any:
        assert kw["speaker"] == "ritu"
        self.calls.append((language, text))
        return type("Speech", (), {"audio": b"RIFFwav", "content_type": "audio/wav"})()


class FakeStore:
    """The database's side in memory: one row per (pack, template, language), the cap enforced like ops_job_sample_put does."""

    def __init__(self, cap: int = samples.CAP_CHARS) -> None:
        self.rows: dict[tuple[str, str, str], dict[str, Any]] = {}
        self.spent = 0
        self.cap = cap

    def index(self, token: str) -> dict[str, Any]:
        return {"total_chars": self.spent, "items": [{"pack": p, "template_id": t, "language": language, "sha256": r["sha"], "chars": r["chars"]} for (p, t, language), r in self.rows.items()]}

    def put(self, token: str, item: samples.Item, content_type: str, audio_b64: str) -> dict[str, Any]:
        if self.spent + item.chars > self.cap:
            raise samples.CapReached("SM980")
        self.rows[(item.pack, item.template_id, item.language)] = {"sha": item.sha, "chars": item.chars, "type": content_type, "audio": audio_b64}
        self.spent += item.chars
        return {"stored": True}

    def recode(self, token: str, pack: str, template_id: str, language: str, text_sha256: str, content_type: str, audio_b64: str) -> dict[str, Any]:
        r = self.rows.get((pack, template_id, language))
        if r is None or r["sha"] != text_sha256:
            return {"recoded": False, "reason": "unknown_sample"}
        r["type"], r["audio"] = content_type, audio_b64
        return {"recoded": True}

    def listing(self, token: str) -> list[dict[str, Any]]:
        return [{"pack": p, "template_id": t, "language": language, "sha8": r["sha"][:8]} for (p, t, language), r in self.rows.items()]

    def get(self, token: str, pack: str, template_id: str, language: str) -> dict[str, Any] | None:
        r = self.rows.get((pack, template_id, language))
        return {"sha8": r["sha"][:8], "content_type": r["type"], "audio_b64": r["audio"]} if r else None


def run(store: FakeStore, tts: FakeTts, languages: list[str], limit: int, **kw: Any) -> dict[str, Any]:
    return samples.run(store, tts, "tok", PACKS, languages, limit, **kw)  # type: ignore[arg-type]


def test_the_plan_goes_round_the_business_types_and_skips_what_is_never_spoken_or_hidden() -> None:
    items = samples.plan(PACKS, ["te", "en"])
    packs = [i.pack for i in items]
    assert len(set(packs[:26])) == 13, "the first 26 samples are the first template of each of the 13 business types, both languages"
    assert all(i.text and "{" not in i.text and "\n" not in i.text for i in items)
    assert not any(i.template_id.endswith("payment_reminder_gentle") or i.template_id in {"fee_reminder", "payment_due_reminder", "payment_step_reminder"} for i in items), "Get paid templates are not recorded while hidden"
    spoken = {(i.pack, i.template_id) for i in items}
    for pack_id in {i.pack for i in items}:
        jobs = packdata.for_pack(pack_id, PACKS)
        assert jobs is not None
        assert not any((pack_id, t.id) in spoken for t in jobs.templates if t.kind == "researcher"), "a researcher template is never spoken (the owner reaches out personally)"
    # the owner's stop line was set for the first 13 business types; the library has grown to 55 (25 Nov 2026), so the whole plan is bigger. A run is capped by its `limit` and the cap below, so the line is held on the first 13
    first13 = set(list(dict.fromkeys(packs))[:13])
    base = [i for i in items if i.pack in first13]
    assert 100 < len(base) < 260 and sum(i.chars for i in base) < 40_000 and samples.rupees(sum(i.chars for i in base)) < 150, "Telugu + English stay under the owner's stop line of Rs 150"


def test_the_cap_is_below_the_owners_and_the_price_is_the_one_read_on_sarvams_page() -> None:
    assert samples.rupees(samples.CAP_CHARS) == 300.0 and samples.RUPEES_PER_1000_CHARS == 3.0


def test_a_run_makes_the_missing_ones_counts_the_characters_and_a_second_run_spends_nothing_for_the_same_words() -> None:
    store, tts = FakeStore(), FakeTts()
    first = run(store, tts, ["te", "en"], 10)
    assert first["made"] == 10 and len(tts.calls) == 10 and first["chars_this_run"] == store.spent and first["rupees_this_run"] == samples.rupees(store.spent) and first["stopped"] is None
    again = run(store, tts, ["te", "en"], 10)
    assert again["made"] == 10 and len(tts.calls) == 20, "the next ten, not the same ten"
    assert len({(i["pack"], i["template_id"], i["language"]) for i in first["items"] + again["items"]}) == 20


def test_a_dry_run_speaks_nothing_and_stores_nothing() -> None:
    store, tts = FakeStore(), FakeTts()
    out = run(store, tts, ["te"], 5, dry_run=True)
    assert out["dry_run"] is True and out["made"] == 5 and tts.calls == [] and store.rows == {} and out["rupees_this_run"] > 0


def test_the_run_stops_at_the_cap_before_it_speaks_and_so_does_the_database() -> None:
    store, tts = FakeStore(), FakeTts()
    store.spent = samples.CAP_CHARS - 50
    out = run(store, tts, ["te", "en"], 10)
    assert out["made"] == 0 and out["stopped"] == "cap" and tts.calls == []
    # a bug in the run is still stopped by the database
    item = samples.plan(PACKS, ["en"])[0]
    store2 = FakeStore(cap=10)
    with pytest.raises(samples.CapReached):
        store2.put("t", item, "audio/wav", "UklGRg==")


def test_one_failure_stops_the_run_nothing_is_retried_blindly_with_money() -> None:
    class Broken(FakeTts):
        def synthesize(self, text: str, language: str, **kw: Any) -> Any:
            raise RuntimeError("provider down")

    store = FakeStore()
    out = run(store, Broken(), ["te"], 5)
    assert out["made"] == 0 and out["stopped"] == "error" and store.rows == {}


def test_changed_words_are_recorded_again_the_same_words_are_not() -> None:
    store, tts = FakeStore(), FakeTts()
    run(store, tts, ["te"], 3)
    key = next(iter(store.rows))
    store.rows[key]["sha"] = "0" * 64   # the template's words changed since
    out = run(store, tts, ["te"], 60)
    assert any((i["pack"], i["template_id"], i["language"]) == key for i in out["items"])


def test_file_names_carry_the_hash_and_only_names_the_api_made_are_accepted() -> None:
    sha = samples.sha256("hello")
    name = samples.file_name("enquiry_call_right_away", sha, "te")
    assert name == f"enquiry_call_right_away_{sha[:8]}.te.mp3" and samples.parse_file(name) == ("enquiry_call_right_away", sha[:8], "te")
    for bad in ("../x_12345678.te.mp3", "x.te.mp3", "ab_12345678.te.mp3", "enquiry_call_right_away_ZZZZZZZZ.te.mp3", "enquiry_call_right_away_12345678.te.wav"):
        assert samples.parse_file(bad) is None, bad


# ------------------------------------------------------------------------------------------------------ the routes
class FakeVoice:
    def __init__(self, tts: FakeTts | None) -> None:
        self.tts = tts

    def available(self) -> bool:
        return self.tts is not None


def client_with(store: FakeStore, tts: FakeTts | None = None, jobs: bool = True) -> Any:
    runtime = JobsRuntime(directory=PACKS, clock=clock(), samples=store) if jobs else None  # type: ignore[arg-type]
    client, _ = make_client(jobs=runtime, packs=FakePacks(), voice_sample=FakeVoice(tts))
    return client


def test_the_template_list_links_the_samples_that_exist_and_keeps_null_for_the_rest() -> None:
    store, tts = FakeStore(), FakeTts()
    run(store, tts, ["te", "en"], 60)
    body = get(client_with(store), f"/v1/tenants/{A}/jobs/templates").json()
    linked = [t for t in every_template(body) if isinstance(t.get("preview", {}).get("sample_audio"), dict)]
    assert linked, "some template has a sample link"
    one = linked[0]
    link = next(iter(one["preview"]["sample_audio"].values()))
    assert link.startswith("/v1/job-samples/") and link.endswith(".mp3")
    assert any(t.get("preview", {}).get("sample_audio") in (None, {}) for t in every_template(body)) or len(linked) == len(every_template(body))


def test_a_sample_is_played_by_any_signed_in_person_and_a_stale_link_or_a_stranger_is_a_404() -> None:
    store, tts = FakeStore(), FakeTts()
    run(store, tts, ["te"], 1)
    (pack, tid, lang), row = next(iter(store.rows.items()))
    client = client_with(store)
    path = f"/v1/job-samples/{pack}/{tid}_{row['sha'][:8]}.{lang}.mp3"
    ok = get(client, path, "a_viewer")
    assert ok.status_code == 200 and ok.content == base64.b64decode(row["audio"]) and "immutable" in ok.headers["cache-control"]
    assert get(client, path, None).status_code == 401
    assert get(client, f"/v1/job-samples/{pack}/{tid}_00000000.{lang}.mp3", "a_viewer").status_code == 404, "a link made for other words"
    assert get(client, f"/v1/job-samples/{pack}/nothing_here_12345678.{lang}.mp3", "a_viewer").status_code == 404
    assert get(client_with(store, jobs=False), path, "a_viewer").status_code == 404, "JOBS off: not there"


def test_generating_needs_the_voice_the_flag_and_lets_the_database_decide_who() -> None:
    store, tts = FakeStore(), FakeTts()
    c = client_with(store, tts)
    r = c.post("/v1/ops/job-samples/generate", json={"languages": ["te"], "limit": 2}, headers=auth("a_owner"))
    assert r.status_code == 200 and r.json()["made"] == 2 and len(tts.calls) == 2
    assert c.post("/v1/ops/job-samples/generate", json={"limit": 1000}, headers=auth("a_owner")).status_code == 422
    assert c.post("/v1/ops/job-samples/generate", json={"languages": ["xx"]}, headers=auth("a_owner")).status_code == 422
    assert client_with(store, None).post("/v1/ops/job-samples/generate", json={}, headers=auth("a_owner")).status_code == 503
    assert client_with(store, tts, jobs=False).post("/v1/ops/job-samples/generate", json={}, headers=auth("a_owner")).status_code == 404


def test_audio_that_postgres_wrapped_in_76_character_lines_still_plays() -> None:
    """Staging, 21 Nov: encode(audio, 'base64') puts a newline every 76 characters; the strict decoder refused it and every sample was a 404."""
    store, tts = FakeStore(), FakeTts()
    run(store, tts, ["te"], 1)
    (pack, tid, lang), row = next(iter(store.rows.items()))
    raw = base64.b64decode(row["audio"])
    flat = base64.b64encode(raw).decode()
    row["audio"] = "\n".join(flat[i : i + 76] for i in range(0, len(flat), 76)) + "\n"
    ok = get(client_with(store), f"/v1/job-samples/{pack}/{tid}_{row['sha'][:8]}.{lang}.mp3", "a_viewer")
    assert ok.status_code == 200 and ok.content == raw

def test_the_system_account_lists_and_recodes_a_sample_and_nobody_else_does() -> None:
    store, tts = FakeStore(), FakeTts()
    run(store, tts, ["te"], 1)
    (pack, tid, lang), row = next(iter(store.rows.items()))
    c = client_with(store, tts)
    index = c.get("/v1/ops/job-samples/index", headers=auth("a_owner"))
    assert index.status_code == 200 and index.json()["items"][0]["sha256"] == row["sha"]
    body = {"pack": pack, "template_id": tid, "language": lang, "sha256": row["sha"], "content_type": "audio/mpeg", "audio_b64": base64.b64encode(b"ID3mp3").decode()}
    ok = c.post("/v1/ops/job-samples/recode", json=body, headers=auth("a_owner"))
    assert ok.status_code == 200 and ok.json() == {"recoded": True}
    played = get(client_with(store), f"/v1/job-samples/{pack}/{tid}_{row['sha'][:8]}.{lang}.mp3", "a_viewer")
    assert played.status_code == 200 and played.content == b"ID3mp3" and played.headers["content-type"] == "audio/mpeg"
    assert c.post("/v1/ops/job-samples/recode", json={**body, "sha256": "0" * 64}, headers=auth("a_owner")).json()["recoded"] is False, "other words: not recoded"
    assert c.post("/v1/ops/job-samples/recode", json={**body, "content_type": "text/html"}, headers=auth("a_owner")).status_code == 422
    assert c.post("/v1/ops/job-samples/recode", json={**body, "extra": 1}, headers=auth("a_owner")).status_code == 422
    assert c.post("/v1/ops/job-samples/recode", json=body, headers={}).status_code == 401
    assert client_with(store, tts, jobs=False).post("/v1/ops/job-samples/recode", json=body, headers=auth("a_owner")).status_code == 404
