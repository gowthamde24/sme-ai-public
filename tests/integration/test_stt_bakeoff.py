"""Job AK / K3, extended by job BD: the voice bake-off, tested with a temporary folder and mock transports: no key, no network, no real audio of anyone.

Proved: the word and character error rate arithmetic (including Telugu words and punctuation), the keyterms limits, the folder rules (outside the repository, size and count limits, only .wav and .m4a, the
truth and Chrome files by name, the language from the file name), every adapter switched on only by its own environment variables, the per-language table with latency and list prices, the spend guard,
text-to-speech audio written to tts-out for listening, and that the report lands outside the repository. The request shapes of the providers are tested in services/ai-api/tests/test_voice.py."""

# ruff: noqa: E501

from __future__ import annotations

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
    make_wav(tmp_path / "te-01-order.wav")
    (tmp_path / "te-01-order.truth.txt").write_text(TELUGU_TRUTH, encoding="utf-8")
    (tmp_path / "te-01-order.txt").write_text(
        "ఈ రోజు యాభై చీరలకు కోట్ పంపండి", encoding="utf-8"
    )  # Chrome got it right
    make_wav(tmp_path / "en-01-price.wav", 1.0)
    (tmp_path / "en-01-price.truth.txt").write_text("price of kanjivaram saree", encoding="utf-8")
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
def test_the_folder_gives_each_sample_its_truth_its_chrome_result_and_its_language(
    folder: Path,
) -> None:
    samples = stt.discover(folder)
    assert [s.name for s in samples] == ["en-01-price", "te-01-order"], "only .wav and .m4a"
    en, te = samples
    assert te.truth == TELUGU_TRUTH and te.chrome is not None and te.language == "te"
    assert en.truth == "price of kanjivaram saree" and en.chrome is None and en.language == "en"
    assert stt.Sample(Path("x.wav"), None, None).language is None
    assert stt.Sample(Path("hi-9-x.m4a"), None, None).language == "hi"
    assert stt.Sample(Path("fr-9-x.m4a"), None, None).language is None


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


def test_audio_length_is_measured_for_wav_and_m4a(folder: Path) -> None:
    assert stt.audio_seconds(folder / "te-01-order.wav") == pytest.approx(0.5)
    assert stt.wav_seconds(folder / "te-01-order.wav") == pytest.approx(0.5)
    assert stt.wav_seconds(folder / "x.m4a") is None


# ------------------------------------------------------------------------------------------------ characters and money
def test_character_error_rate_counts_letters_not_words() -> None:
    assert stt.cer("kanjivaram", "kanjivaram") == 0
    assert stt.cer("kanjivaram", "kanjivaran") == pytest.approx(1 / 10)
    assert stt.cer("ab cd", "ab cd.") == 0, "punctuation does not count"
    assert stt.cer("", "") == 0 and stt.cer("", "x") == 1.0
    assert stt.cer(TELUGU_TRUTH, TELUGU_TRUTH) == 0
    assert (
        0
        < stt.cer(TELUGU_TRUTH, "ఈ రోజు యాభై చీరలకు కోటు పంపండి")
        < stt.wer(TELUGU_TRUTH, "ఈ రోజు యాభై చీరలకు కోటు పంపండి")
    ), "one wrong letter is less than one wrong word"


def test_prices_are_shown_in_rupees_and_dollar_prices_are_converted_at_a_stated_rate() -> None:
    from app.voice.interface import Price

    assert stt.price_text(Price(inr_per_minute=0.5)) == "Rs 0.50/min"
    assert stt.price_text(Price(inr_per_minute=0.0)) == "free"
    assert "$0.016/min" in stt.price_text(
        Price(usd_per_minute=0.016)
    ) and "Rs 1.41" in stt.price_text(Price(usd_per_minute=0.016))
    assert stt.price_text(Price()) == "not published"
    assert stt.inr_per_minute(Price(usd_per_minute=0.01)) == pytest.approx(0.88)
    assert stt.inr_per_minute(Price()) is None


# ------------------------------------------------------------------------------------------------ the engines
class Recorder:
    """A mock HTTP service that answers every provider the same way and keeps the requests."""

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


def test_engines_are_enabled_only_by_their_own_variables(folder: Path) -> None:
    samples = stt.discover(folder)

    def names(env: dict[str, str]) -> list[str]:
        return [e.name for e in stt.engines_from(env, samples)]

    assert names({}) == ["chrome"], "only the .txt file of the folder"
    assert names({"SARVAM_API_KEY": KEY}) == ["sarvam", "chrome"]
    assert names({"BHASHINI_API_KEY": KEY}) == ["chrome"], (
        "a key without its service id switches nothing on"
    )
    assert names({"BHASHINI_API_KEY": KEY, "BHASHINI_ASR_SERVICE_ID": "svc"}) == [
        "bhashini",
        "chrome",
    ]
    assert names({"GOOGLE_API_KEY": KEY}) == ["google", "chrome"]
    assert names({"AI4BHARAT_STT_URL": "https://m.example.test/stt"}) == ["ai4bharat", "chrome"]
    everything = {
        "SARVAM_API_KEY": KEY,
        "BHASHINI_API_KEY": KEY,
        "BHASHINI_ASR_SERVICE_ID": "s",
        "GOOGLE_API_KEY": KEY,
        "AI4BHARAT_STT_URL": "https://m.example.test/stt",
    }
    assert names(everything) == ["sarvam", "bhashini", "google", "ai4bharat", "chrome"]
    assert stt.engines_from({}, [stt.Sample(Path("x.wav"), None, None)]) == []
    assert [
        type(a).__name__
        for a in stt.tts_adapters_from({"SARVAM_API_KEY": KEY, "GOOGLE_API_KEY": KEY})
    ] == ["SarvamTts", "GoogleTts"]
    assert stt.tts_adapters_from({"BHASHINI_API_KEY": KEY}) == [], (
        "text to speech needs its own service id"
    )


def test_chrome_is_the_txt_file_and_sends_nothing(folder: Path) -> None:
    chrome = stt.Chrome()
    te = next(s for s in stt.discover(folder) if s.name == "te-01-order")
    assert chrome.transcribe(te, []) == TELUGU_TRUTH
    en = next(s for s in stt.discover(folder) if s.name == "en-01-price")
    with pytest.raises(stt.EngineError) as e:
        chrome.transcribe(en, [])
    assert str(e.value) == "no_file"


# ------------------------------------------------------------------------------------------------ the whole run
def run_main(folder: Path, report: Path, env: dict[str, str], rec: Recorder) -> int:
    return stt.main(
        [str(folder)],
        env={**env, "REPORT": str(report)},
        client=rec.client(),
        keyterms=["Kanjivaram"],
    )


def test_the_run_scores_each_engine_per_language_and_writes_the_report_outside_the_repository(
    folder: Path, tmp_path_factory: pytest.TempPathFactory, capsys: pytest.CaptureFixture[str]
) -> None:
    rec = Recorder(body={"transcript": "ఈ రోజు యాభై చీరలకు కోటు పంపండి", "language_code": "te-IN"})
    report = tmp_path_factory.mktemp("reports") / "voice-bakeoff.md"
    code = run_main(folder, report, {"SARVAM_API_KEY": KEY}, rec)
    out = capsys.readouterr()
    assert code == 0 and KEY not in out.out + out.err
    text = report.read_text(encoding="utf-8")
    assert (
        KEY not in text
        and "## Speech to text, by language" in text
        and "| te |" in text
        and "| en |" in text
    )
    assert "ఈ రోజు యాభై చీరలకు" in text and "Rs 0.50/min" in text and "character error" in text
    assert not (stt.ROOT / "voice-bakeoff.md").exists()
    # the request went with the language of the file name
    bodies = [r.read() for r in rec.requests]
    assert any(b"te-IN" in b for b in bodies) and any(b"en-IN" in b for b in bodies)
    assert all(r.headers.get("api-subscription-key") == KEY for r in rec.requests)
    summary = stt.run(
        stt.discover(folder),
        stt.engines_from({"SARVAM_API_KEY": KEY}, stt.discover(folder), rec.client()),
        [],
    )
    by = {(r.engine, r.sample): r for r in summary.rows}
    assert (
        by[("sarvam", "te-01-order")].wer == pytest.approx(1 / 6)
        and 0 < (by[("sarvam", "te-01-order")].cer or 0) < 1 / 6
    )
    assert (
        by[("chrome", "te-01-order")].wer == 0 and by[("chrome", "en-01-price")].error == "no_file"
    )
    assert summary.mean_wer("chrome") == "0.0%" and summary.mean_wer("sarvam", "te") != "n/a"
    assert summary.failed("chrome") == 0, "a sample with no Chrome file is not a failure"
    assert by[("sarvam", "te-01-order")].audio_seconds == pytest.approx(0.5)


def test_a_failing_engine_is_counted_and_does_not_stop_the_others(folder: Path) -> None:
    broken = Recorder(status=500, body={})
    summary = stt.run(
        stt.discover(folder),
        stt.engines_from({"SARVAM_API_KEY": KEY}, stt.discover(folder), broken.client()),
        [],
    )
    assert (
        summary.failed("sarvam") == 2
        and summary.mean_wer("sarvam") == "n/a"
        and summary.mean_wer("chrome") == "0.0%"
    )
    errors = {r.error for r in summary.rows if r.engine == "sarvam"}
    assert errors == {"http_500"}, "a constant code, not the provider's words"
    assert "n/a" in stt.table(summary, stt.discover(folder))


def test_a_file_the_adapters_would_refuse_is_an_error_not_a_crash(tmp_path: Path) -> None:
    (tmp_path / "te-01-x.wav").write_bytes(b"not audio at all" * 40)
    (tmp_path / "te-01-x.truth.txt").write_text("hello there", encoding="utf-8")
    summary = stt.run(
        stt.discover(tmp_path),
        stt.engines_from(
            {"SARVAM_API_KEY": KEY}, stt.discover(tmp_path), Recorder(body={}).client()
        ),
        [],
    )
    assert [r.error for r in summary.rows] == ["audio_unsupported_audio"]


def test_text_to_speech_is_spoken_for_a_few_sentences_per_language_and_saved_for_listening(
    folder: Path, tmp_path_factory: pytest.TempPathFactory, capsys: pytest.CaptureFixture[str]
) -> None:
    import base64

    from app.voice.fake import tone

    rec = Recorder(body={"transcript": "x", "audios": [base64.b64encode(tone(0.3)).decode()]})
    report = tmp_path_factory.mktemp("r2") / "voice-bakeoff.md"
    assert run_main(folder, report, {"SARVAM_API_KEY": KEY, "TTS_PER_LANGUAGE": "1"}, rec) == 0
    saved = sorted(p.name for p in (folder / "tts-out").iterdir())
    assert saved == ["sarvam-en-01-price.wav", "sarvam-te-01-order.wav"]
    text = report.read_text(encoding="utf-8")
    assert (
        "## Text to speech" in text
        and "Rs 3.00 per 1,000 characters" in text
        and "sarvam-te-01-order.wav" in text
    )
    assert KEY not in text + capsys.readouterr().out


def test_the_estimate_is_printed_and_a_run_over_the_limit_is_refused_unless_confirmed(
    folder: Path, tmp_path_factory: pytest.TempPathFactory, capsys: pytest.CaptureFixture[str]
) -> None:
    rec = Recorder(body={"transcript": "x"})
    report = tmp_path_factory.mktemp("r3") / "voice-bakeoff.md"
    assert run_main(folder, report, {"SARVAM_API_KEY": KEY, "MAX_SPEND_INR": "0.001"}, rec) == 2
    err = capsys.readouterr()
    assert (
        "estimated cost" in err.out
        and "above Rs 0" in err.err
        and rec.requests == []
        and not report.exists()
    )
    assert (
        run_main(
            folder,
            report,
            {"SARVAM_API_KEY": KEY, "MAX_SPEND_INR": "0.001", "CONFIRM_SPEND": "1"},
            rec,
        )
        == 0
    )
    assert rec.requests, "confirmed: it ran"


def test_the_report_may_not_be_written_inside_the_repository(
    folder: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    with pytest.raises(stt.FolderError, match="inside the repository"):
        stt.write_report(stt.ROOT / "docs" / "x.md", stt.Summary(), [])


def test_the_command_refuses_in_one_line_before_doing_anything(
    folder: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert stt.main([str(stt.ROOT / "docs")], env={"SARVAM_API_KEY": KEY}) == 2
    err = capsys.readouterr().err
    assert "inside the repository" in err and KEY not in err
    bare = folder.parent / "bare"
    bare.mkdir()
    make_wav(bare / "a.wav")
    assert stt.main([str(bare)], env={}) == 2
    err = capsys.readouterr().err
    assert err.count("\n") == 1 and "SARVAM_API_KEY" in err and "read -rs" in err


def test_the_default_folder_and_report_are_the_owners_desktop() -> None:
    assert (
        stt.DEFAULT_DIR == "~/Desktop/voice-samples"
        and stt.DEFAULT_REPORT == "~/Desktop/v2-overnight/voice-bakeoff.md"
    )
