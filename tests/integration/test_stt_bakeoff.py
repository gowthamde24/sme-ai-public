"""Job AK / K3: the speech-to-text bake-off, tested with a temporary folder and mock transports: no key, no network, no real audio of anyone.

Proved: the word error rate arithmetic (including Telugu words and punctuation), the keyterms limits, the folder rules (outside the repository, size and count limits, only .wav and .m4a, the
truth and Chrome files by name), the Sarvam and Bhashini request shapes, constant error codes that carry nothing, the table, and that the report lands in the folder and never in the repository."""

# ruff: noqa: E501

from __future__ import annotations

import json
import wave
from pathlib import Path
from typing import Any

import httpx
import pytest
import stt_bakeoff as stt

KEY = "sarvam-test-key-not-real-0123456789"
TELUGU_TRUTH = "ఈ రోజు యాభై చీరలకు కోట్ పంపండి"


def make_wav(path: Path, seconds: float = 0.5) -> None:
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(b"\x00\x00" * int(16000 * seconds))


@pytest.fixture
def folder(tmp_path: Path) -> Path:
    make_wav(tmp_path / "one.wav")
    (tmp_path / "one.truth.txt").write_text(TELUGU_TRUTH, encoding="utf-8")
    (tmp_path / "one.txt").write_text(
        "ఈ రోజు యాభై చీరలకు కోట్ పంపండి", encoding="utf-8"
    )  # Chrome got it right
    (tmp_path / "two.m4a").write_bytes(b"not really audio")
    (tmp_path / "two.truth.txt").write_text("price of kanjivaram saree", encoding="utf-8")
    (tmp_path / "ignored.mp3").write_bytes(b"x")
    return tmp_path


# ------------------------------------------------------------------------------------------------ words and WER
def test_words_drop_punctuation_and_case_and_keep_indian_script_marks_together() -> None:
    assert stt.words("Price, of KANJIVARAM saree!") == ["price", "of", "kanjivaram", "saree"]
    assert stt.words(TELUGU_TRUTH) == ["ఈ", "రోజు", "యాభై", "చీరలకు", "కోట్", "పంపండి"]
    assert stt.words("  ") == [] and stt.words("a\u200bb") == ["a", "b"], (
        "a zero-width space separates words"
    )
    assert stt.words("క్\u200cష") == stt.words("క్ష"), "an Indic joiner is not a difference"


def test_word_error_rate_counts_substitutions_deletions_and_insertions() -> None:
    assert stt.wer("a b c d", "a b c d") == 0
    assert stt.wer("a b c d", "a x c d") == 0.25, "one substitution"
    assert stt.wer("a b c d", "a b d") == 0.25, "one deletion"
    assert stt.wer("a b c d", "a b x c d") == 0.25, "one insertion"
    assert stt.wer("a b", "x y z") == 1.5, "more than 100 % is possible"
    assert stt.wer("", "") == 0 and stt.wer("", "x") == 1.0
    assert stt.wer(TELUGU_TRUTH, "ఈ రోజు యాభై చీరలకు కోట్ పంపండి.") == 0, "punctuation does not count"
    assert stt.wer(TELUGU_TRUTH, "ఈ రోజు యాభై చీరలకు కోటు పంపండి") == pytest.approx(1 / 6)


def test_keyterms_are_product_words_once_each_within_the_limits() -> None:
    terms = stt.keyterms_from(
        ["Kanjivaram silk saree", "Kanjivaram Border 500", "కంజీవరం చీర", "x", "ab"]
    )
    assert terms == ["Kanjivaram", "silk", "saree", "Border", "కంజీవరం", "చీర"]
    many = stt.keyterms_from([f"word{i:03d}" for i in range(200)])
    assert len(many) == 50 and all(len(t) <= 64 for t in many)
    assert stt.keyterms_from(["a" * 65]) == []


# ------------------------------------------------------------------------------------------------ the folder
def test_the_folder_gives_each_sample_its_truth_and_its_chrome_result(folder: Path) -> None:
    samples = stt.discover(folder)
    assert [s.name for s in samples] == ["one", "two"], "only .wav and .m4a"
    one, two = samples
    assert (
        one.truth == TELUGU_TRUTH
        and one.chrome is not None
        and two.truth == "price of kanjivaram saree"
        and two.chrome is None
    )


def test_a_folder_inside_the_repository_is_refused() -> None:
    for inside in (stt.ROOT, stt.ROOT / "docs", stt.ROOT / "tests"):
        with pytest.raises(stt.FolderError, match="inside the repository"):
            stt.discover(inside)


def test_a_missing_or_empty_or_oversized_folder_is_refused(tmp_path: Path) -> None:
    with pytest.raises(stt.FolderError):
        stt.discover(tmp_path / "nope")
    with pytest.raises(stt.FolderError, match="no .wav"):
        stt.discover(tmp_path)
    for i in range(stt.MAX_FILES + 1):
        (tmp_path / f"f{i}.wav").write_bytes(b"x")
    with pytest.raises(stt.FolderError, match="limit"):
        stt.discover(tmp_path)


def test_a_file_over_the_size_limit_is_refused(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (tmp_path / "big.wav").write_bytes(b"x" * 100)
    monkeypatch.setattr(stt, "MAX_FILE_BYTES", 50)
    with pytest.raises(stt.FolderError, match="too big"):
        stt.discover(tmp_path)


def test_wav_length_is_read_and_other_formats_have_none(folder: Path) -> None:
    assert stt.wav_seconds(folder / "one.wav") == pytest.approx(0.5)
    assert stt.wav_seconds(folder / "two.m4a") is None


# ------------------------------------------------------------------------------------------------ the engines
class Recorder:
    def __init__(self, status: int = 200, body: Any = None, error: Exception | None = None) -> None:
        self.status, self.body, self.error = status, body, error
        self.requests: list[httpx.Request] = []

    def client(self) -> httpx.Client:
        def handler(request: httpx.Request) -> httpx.Response:
            self.requests.append(request)
            if self.error:
                raise self.error
            return httpx.Response(self.status, json=self.body)

        return httpx.Client(transport=httpx.MockTransport(handler))


def sample(folder: Path, name: str = "one") -> stt.Sample:
    return next(s for s in stt.discover(folder) if s.name == name)


def test_sarvam_request_shape_and_transcript(folder: Path) -> None:
    rec = Recorder(body={"transcript": "ఈ రోజు యాభై చీరలకు కోట్ పంపండి", "language_code": "te-IN"})
    engine = stt.Sarvam(KEY, "saaras:v4", "te-IN", rec.client())
    assert engine.transcribe(sample(folder), ["Kanjivaram", "చీర"]) == "ఈ రోజు యాభై చీరలకు కోట్ పంపండి"
    request = rec.requests[0]
    body = request.content.decode("utf-8", errors="replace")
    assert (
        str(request.url) == "https://api.sarvam.ai/speech-to-text"
        and request.headers["api-subscription-key"] == KEY
    )
    assert request.headers["content-type"].startswith("multipart/form-data")
    assert (
        'name="model"' in body
        and "saaras:v4" in body
        and 'name="language_code"' in body
        and "te-IN" in body
    )
    assert (
        'name="keyterms"' in body
        and '["Kanjivaram", "చీర"]' in body
        and 'name="file"' in body
        and "one.wav" in body
    )
    assert KEY not in str(request.url) and KEY not in body and KEY not in repr(engine)


def test_sarvam_sends_no_keyterms_to_a_model_that_does_not_support_them(folder: Path) -> None:
    rec = Recorder(body={"transcript": "x"})
    stt.Sarvam(KEY, "saaras:v3", "unknown", rec.client()).transcribe(sample(folder), ["Kanjivaram"])
    assert "keyterms" not in rec.requests[0].content.decode("utf-8", errors="replace")


def test_bhashini_request_shape_and_transcript(folder: Path) -> None:
    rec = Recorder(
        body={"pipelineResponse": [{"taskType": "asr", "output": [{"source": "కోట్ పంపండి"}]}]}
    )
    engine = stt.Bhashini(KEY, "service-123", "te-IN", rec.client())
    assert engine.transcribe(sample(folder), ["ignored"]) == "కోట్ పంపండి"
    request = rec.requests[0]
    body = json.loads(request.content)
    assert (
        str(request.url) == "https://dhruva-api.bhashini.gov.in/services/inference/pipeline"
        and request.headers["authorization"] == KEY
    )
    task = body["pipelineTasks"][0]
    assert (
        task["taskType"] == "asr"
        and task["config"]["serviceId"] == "service-123"
        and task["config"]["language"] == {"sourceLanguage": "te"}
    )
    assert body["inputData"]["audio"][0]["audioContent"], "the audio goes as base64"
    assert KEY not in json.dumps(body) and KEY not in repr(engine)


@pytest.mark.parametrize(
    "make",
    [
        lambda c: stt.Sarvam(KEY, "saaras:v4", "unknown", c),
        lambda c: stt.Bhashini(KEY, "svc", "te", c),
    ],
)
@pytest.mark.parametrize(
    ("status", "body", "error", "code"),
    [
        (401, {"error": "CANARY-text"}, None, "http_401"),
        (429, {}, None, "http_429"),
        (500, {}, None, "http_500"),
        (200, {"nope": 1}, None, "bad_response"),
        (200, [1], None, "bad_response"),
        (200, None, httpx.ReadTimeout("slow"), "timeout"),
    ],
)
def test_engine_failures_are_constant_codes_that_carry_nothing(
    folder: Path, make: Any, status: int, body: Any, error: Exception | None, code: str
) -> None:
    engine = make(Recorder(status, body, error).client())
    with pytest.raises(stt.EngineError) as raised:
        engine.transcribe(sample(folder), [])
    assert (
        str(raised.value) == code
        and "CANARY" not in str(raised.value)
        and KEY not in str(raised.value)
    )


def test_chrome_is_the_txt_file_and_sends_nothing(folder: Path) -> None:
    assert stt.Chrome().transcribe(sample(folder), []) == "ఈ రోజు యాభై చీరలకు కోట్ పంపండి"
    with pytest.raises(stt.EngineError, match="no_file"):
        stt.Chrome().transcribe(sample(folder, "two"), [])


def test_engines_are_enabled_only_by_their_own_keys(folder: Path) -> None:
    samples = stt.discover(folder)

    def names(env: dict[str, str]) -> list[str]:
        return [e.name for e in stt.engines_from(env, samples)]

    assert names({}) == ["Chrome"]
    assert names({"SARVAM_API_KEY": KEY}) == ["Sarvam Saaras", "Chrome"]
    assert names({"BHASHINI_API_KEY": KEY}) == ["Chrome"], "Bhashini needs its service id too"
    assert names({"BHASHINI_API_KEY": KEY, "BHASHINI_ASR_SERVICE_ID": "s"}) == [
        "Bhashini",
        "Chrome",
    ]
    assert stt.engines_from({}, [stt.Sample(Path("x.wav"), None, None)]) == []


# ------------------------------------------------------------------------------------------------ the whole run
def test_the_run_scores_each_engine_against_the_truth_and_writes_the_report_into_the_folder(
    folder: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    rec = Recorder(
        body={"transcript": "ఈ రోజు యాభై చీరలకు కోటు పంపండి"}
    )  # one word wrong in the 6-word reference of "one"; also used for "two"
    code = stt.main(
        [str(folder)], env={"SARVAM_API_KEY": KEY}, client=rec.client(), keyterms=["Kanjivaram"]
    )
    out = capsys.readouterr()
    assert code == 0 and KEY not in out.out + out.err
    report = (folder / "stt-bakeoff-report.md").read_text(encoding="utf-8")
    assert "Sarvam Saaras" in report and "Chrome" in report and "ఈ రోజు యాభై చీరలకు" in report
    assert KEY not in report
    assert not (stt.ROOT / "stt-bakeoff-report.md").exists(), (
        "nothing about what people said enters the repository"
    )
    # Chrome got "one" right (0 %), Sarvam one word wrong of six (16.7 %) on "one" and everything wrong on "two"
    summary = stt.run(
        stt.discover(folder),
        stt.engines_from({"SARVAM_API_KEY": KEY}, stt.discover(folder), rec.client()),
        [],
    )
    assert summary.mean_wer("Chrome") == "0.0%"
    by = {(r.engine, r.sample): r for r in summary.rows}
    assert (
        by[("Sarvam Saaras", "one")].wer == pytest.approx(1 / 6)
        and by[("Chrome", "two")].error == "no_file"
    )
    assert summary.failed("Chrome") == 0, "a sample with no Chrome file is not a failure"


def test_a_failing_engine_is_counted_and_does_not_stop_the_others(folder: Path) -> None:
    broken = Recorder(status=500, body={})
    summary = stt.run(
        stt.discover(folder),
        stt.engines_from({"SARVAM_API_KEY": KEY}, stt.discover(folder), broken.client()),
        [],
    )
    assert (
        summary.failed("Sarvam Saaras") == 2
        and summary.mean_wer("Sarvam Saaras") == "n/a"
        and summary.mean_wer("Chrome") == "0.0%"
    )
    assert "n/a" in stt.table(summary, stt.discover(folder))


def test_the_command_refuses_in_one_line_before_doing_anything(
    folder: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert stt.main([], env={}) == 2
    assert "DIR" in capsys.readouterr().err
    assert stt.main([str(stt.ROOT / "docs")], env={"SARVAM_API_KEY": KEY}) == 2
    err = capsys.readouterr().err
    assert "inside the repository" in err and KEY not in err
    bare = folder.parent / "bare"
    bare.mkdir()
    make_wav(bare / "a.wav")
    assert stt.main([str(bare)], env={}) == 2
    err = capsys.readouterr().err
    assert err.count("\n") == 1 and "SARVAM_API_KEY" in err
