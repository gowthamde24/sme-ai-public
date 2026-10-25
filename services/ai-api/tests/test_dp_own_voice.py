"""Job DP part 5: the Owner's own voice, with consent. Contract fresh and strict; only the Owner (second factor) makes or deletes; both recordings go to the workspace's private bucket with the Owner's own token;
the provider is given the SAMPLE only, never the consent recording; a refused attempt keeps nothing; a deletion goes provider, then recordings (checked), then the record, and a failed step stops there;
nothing is logged; and the assistant still says it is the AI assistant. The database's own rules are proved in supabase/tests/database/122_dp_own_voice.test.sql."""

# ruff: noqa: E501

from __future__ import annotations

import base64
import inspect
import io
import json
import logging
import struct
import uuid
import wave
from pathlib import Path
from typing import Any

import jsonschema
import pytest

from app.ownvoice import audio_check, contracts, models
from app.ownvoice.repository import PostgrestOwnVoiceRepository
from app.ownvoice.service import OwnVoiceService
from app.tenancy.repository import UpstreamError
from app.voice.fake import FakeVoiceCloner
from app.voice.interface import VoiceCloner
from tests.dp_voice_fakes import FakeOwnVoiceRepository, FakeStorage
from tests.fakes import TENANT_A, auth, make_client

CONTRACTS = Path(__file__).resolve().parents[3] / "packages" / "contracts"
SCHEMA = json.loads((CONTRACTS / "own_voice.schema.json").read_text())
EXAMPLES = json.loads((CONTRACTS / "own_voice.examples.json").read_text())
A = TENANT_A.id
B = f"/v1/tenants/{A}/voice-clone"
NAME = "Suresh Kumar"
VOICE_ID = "5c4d3e2f-1a0b-4c8d-9e7f-6a5b4c3d2e11"


def wav(seconds: float, rate: int = 8000) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(struct.pack("<h", 300) * int(seconds * rate))
    return buf.getvalue()


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


SAMPLE = wav(20)
CONSENT = wav(6)


def body(**changes: Any) -> dict[str, Any]:
    base = {
        "id": VOICE_ID, "name": NAME, "consent_sentence": f"I, {NAME}, allow Stack19 to create an AI voice of me for Sri Lakshmi Silks",
        "sample_base64": b64(SAMPLE), "sample_type": "audio/wav", "sample_seconds": 20.0, "consent_base64": b64(CONSENT), "consent_type": "audio/wav", "consent_seconds": 6.0,
    }
    return {**base, **changes}


def world(**kw: Any) -> tuple[Any, FakeOwnVoiceRepository, FakeStorage, FakeVoiceCloner]:
    storage = FakeStorage()
    repo = FakeOwnVoiceRepository(storage)
    cloner = FakeVoiceCloner(**kw)
    client, _ = make_client(own_voice=OwnVoiceService(repo, storage, cloner))
    return client, repo, storage, cloner


# ------------------------------------------------------------------------------------------------ the contract
def test_the_schema_and_the_typescript_are_up_to_date() -> None:
    assert (CONTRACTS / "own_voice.schema.json").read_text() == contracts.schema_text(), "run `make contracts`"
    assert (CONTRACTS / "own_voice.ts").read_text() == contracts.ts_text(), "run `make contracts`"


def test_every_shape_forbids_unknown_properties_and_no_answer_can_carry_a_recording() -> None:
    for name, node in SCHEMA["$defs"].items():
        if "properties" in node:
            assert node.get("additionalProperties") is False, name
    for model in (models.OwnVoiceOut, models.SentenceOut):
        assert not [f for f in model.model_fields if any(w in f for w in ("base64", "audio", "path", "url", "bucket", "sample_path", "consent_path", "provider_voice_id"))], model.__name__


@pytest.mark.parametrize(("example", "model"), [("sentence", models.SentenceOut), ("voice_none", models.OwnVoiceOut), ("voice_ready", models.OwnVoiceOut), ("voice_deleted", models.OwnVoiceOut), ("create_request", models.OwnVoiceIn)])
def test_the_example_payloads_match_the_models_and_the_schema(example: str, model: type) -> None:
    payload = EXAMPLES[example]
    model.model_validate(payload)  # type: ignore[attr-defined]
    jsonschema.validate(payload, {**SCHEMA, "$ref": f"#/$defs/{model.__name__}"})


# ------------------------------------------------------------------------------------------------ the sentence
def test_the_sentence_is_the_fixed_one_with_the_name_and_the_business() -> None:
    client, *_ = world()
    out = client.get(f"{B}/sentence", params={"name": NAME}, headers=auth("a_owner"))
    assert out.status_code == 200 and out.json()["sentence"] == "I, Suresh Kumar, allow Stack19 to create an AI voice of me for Sri Lakshmi Silks"
    for bad in ("", "A", "<b>x</b>", "a@b", "x" * 81):
        assert client.get(f"{B}/sentence", params={"name": bad}, headers=auth("a_owner")).status_code == 422, bad
    for user in ("a_admin", "a_sales", "a_viewer"):
        assert client.get(f"{B}/sentence", params={"name": NAME}, headers=auth(user)).status_code == 403, user


# ------------------------------------------------------------------------------------------------ who may
def test_only_the_owner_with_a_second_factor_makes_or_deletes_and_an_admin_may_look() -> None:
    client, repo, storage, cloner = world()
    for user in ("a_admin", "a_sales", "a_viewer"):
        assert client.post(B, json=body(), headers=auth(user)).status_code == 403, user
        assert client.post(f"{B}/delete", headers=auth(user)).status_code == 403, user
    assert client.post(B, json=body(), headers=auth("a_owner", aal="aal1")).status_code == 403
    assert client.post(f"{B}/delete", headers=auth("a_owner", aal="aal1")).status_code == 403
    assert client.post(B, json=body(), headers=auth("b_owner")).status_code == 404
    assert client.post(B, json=body()).status_code == 401
    assert storage.files == {} and cloner.voices == {} and repo.row is None, "a refused caller touches nothing"
    assert client.get(B, headers=auth("a_admin")).status_code == 200
    assert client.get(B, headers=auth("a_sales")).status_code == 403
    assert client.get(B, headers=auth("a_viewer")).status_code == 403


# ------------------------------------------------------------------------------------------------ making the voice
def test_the_owner_makes_the_voice_and_it_is_ready_with_the_consent_on_record() -> None:
    client, repo, storage, cloner = world()
    r = client.post(B, json=body(), headers=auth("a_owner"))
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["status"] == "ready" and out["consenting_name"] == NAME and out["languages"] == ["en", "te", "hi", "kn"]
    assert out["says_ai_assistant"] is True and out["fake"] is True and out["consented_at"] and out["sample_seconds"] == 20.0 and out["consent_seconds"] == 6.0
    bucket = f"ovc-{repo.tenant}"
    assert set(storage.files) == {(bucket, f"{VOICE_ID}/sample.wav"), (bucket, f"{VOICE_ID}/consent.wav")}, "both recordings are in the workspace's private bucket"
    assert len(set(storage.tokens)) == 1 and storage.tokens[0], "uploaded with the Owner's own token"
    begin = next(a for n, a in repo.calls if n == "begin")
    assert begin["sentence"] == f"I, {NAME}, allow Stack19 to create an AI voice of me for Sri Lakshmi Silks" and begin["sample_seconds"] == 20.0 and begin["consent_seconds"] == 6.0
    assert len(cloner.voices) == 1 and next(iter(cloner.voices.values())) == len(SAMPLE), "the provider was given the SAMPLE and nothing else"
    assert [n for n, _ in repo.calls if n in ("begin", "ready")] == ["begin", "ready"]


def test_the_provider_is_never_given_the_consent_recording() -> None:
    params = set(inspect.signature(VoiceCloner.create).parameters) - {"self"}
    assert params == {"sample", "content_type", "label"}
    client, _, _, cloner = world()
    client.post(B, json=body(consent_base64=b64(wav(5.5))), headers=auth("a_owner"))
    assert list(cloner.voices.values()) == [len(SAMPLE)]


def test_a_second_voice_is_refused_while_one_lives_and_allowed_after_a_deletion() -> None:
    client, repo, storage, cloner = world()
    assert client.post(B, json=body(), headers=auth("a_owner")).status_code == 200
    again = client.post(B, json=body(id=str(uuid.uuid4())), headers=auth("a_owner"))
    assert again.status_code == 409 and again.json()["error"]["code"] == "voice_exists"
    assert len(cloner.voices) == 1
    assert client.post(f"{B}/delete", headers=auth("a_owner")).status_code == 200
    assert client.post(B, json=body(id=str(uuid.uuid4())), headers=auth("a_owner")).status_code == 200


def test_a_sentence_that_is_not_the_one_to_read_is_refused_and_nothing_is_kept() -> None:
    client, repo, storage, cloner = world()
    r = client.post(B, json=body(consent_sentence="I, Suresh Kumar, allow someone else to use my voice anywhere at all"), headers=auth("a_owner"))
    assert r.status_code == 422 and r.json()["error"]["code"] == "consent_sentence_mismatch"
    assert storage.files == {} and cloner.voices == {} and repo.row is None, "the recordings of a refused consent are removed"


@pytest.mark.parametrize(
    ("changes", "status", "code"),
    [
        ({"sample_seconds": 10.0}, 422, None),
        ({"sample_seconds": 61.0}, 422, None),
        ({"consent_seconds": 1.0}, 422, None),
        ({"consent_seconds": 31.0}, 422, None),
        ({"sample_type": "image/png"}, 422, None),
        ({"name": "<b>x</b>"}, 422, None),
        ({"name": "A"}, 422, None),
        ({"sample_base64": "not base64 !!" + "x" * 100}, 422, "recording_not_base64"),
        ({"sample_base64": b64(b"<html>not audio</html>" * 20)}, 422, "recording_not_audio"),
        ({"sample_base64": b64(wav(40)), "sample_seconds": 20.0}, 422, "recording_length_mismatch"),
        ({"consent_base64": b64(b"RIFF" + b"\x00" * 200)}, 422, "recording_not_audio"),
        ({"surprise": 1}, 422, None),
    ],
)
def test_a_bad_request_or_a_bad_recording_is_refused_before_anything_is_stored(changes: dict[str, Any], status: int, code: str | None) -> None:
    client, repo, storage, cloner = world()
    r = client.post(B, json=body(**changes), headers=auth("a_owner"))
    assert r.status_code == status, r.text
    if code:
        assert r.json()["error"]["code"] == code
    assert storage.files == {} and cloner.voices == {} and repo.row is None and ("ensure_bucket", None) not in repo.calls


def test_the_audio_checks_themselves() -> None:
    assert audio_check.check(wav(20), "audio/wav", 20.0) == 20.0
    with pytest.raises(audio_check.AudioRefused) as e:
        audio_check.check(b"RIFF", "audio/wav", 20.0)
    assert e.value.code == "not_audio"
    ogg = b"OggS" + b"\x00" * 60_000
    assert audio_check.check(ogg, "audio/ogg", 20.0) == 20.0
    with pytest.raises(audio_check.AudioRefused) as e2:
        audio_check.check(b"OggS" + b"\x00" * 100, "audio/ogg", 20.0)
    assert e2.value.code == "implausible_length"
    with pytest.raises(audio_check.AudioRefused) as e3:
        audio_check.check(b"OggS" + b"\x00" * 9_000_000, "audio/ogg", 20.0)
    assert e3.value.code == "implausible_length"
    with pytest.raises(audio_check.AudioRefused):
        audio_check.check(b"OggS....", "audio/webm", 20.0)


def test_a_provider_that_refuses_keeps_nothing_and_says_so() -> None:
    client, repo, storage, cloner = world(fail="unavailable")
    r = client.post(B, json=body(), headers=auth("a_owner"))
    assert r.status_code == 502 and r.json()["error"]["code"] == "voice_provider_refused"
    assert storage.files == {} and repo.row is not None and repo.row["status"] == "failed" and cloner.voices == {}
    assert client.get(B, headers=auth("a_owner")).json()["status"] == "failed"


def test_if_the_record_of_ready_fails_the_providers_voice_is_deleted_again() -> None:
    client, repo, storage, cloner = world()
    repo.fail_ready = UpstreamError("down")
    r = client.post(B, json=body(), headers=auth("a_owner"))
    assert r.status_code >= 500
    assert cloner.voices == {} and len(cloner.deleted) == 1, "nothing keeps running that the database does not know of"


# ------------------------------------------------------------------------------------------------ deleting
def test_delete_my_voice_removes_the_provider_voice_both_recordings_and_the_name() -> None:
    client, repo, storage, cloner = world()
    client.post(B, json=body(), headers=auth("a_owner"))
    r = client.post(f"{B}/delete", headers=auth("a_owner"))
    assert r.status_code == 200
    out = r.json()
    assert out["status"] == "deleted" and out["consenting_name"] is None and out["languages"] == [] and out["deleted_at"]
    assert cloner.voices == {} and len(cloner.deleted) == 1
    assert storage.files == {}
    assert repo.row is not None and repo.row["name"] is None and repo.row["sentence"] is None and repo.row["sample_path"] is None
    assert repo.assistant_persona == "female_warm", "an assistant that spoke with the voice goes back to a stock one"
    order = [n for n, _ in repo.calls if n in ("private", "deleted")]
    assert order == ["private", "deleted"]


def test_deleting_when_there_is_no_voice_changes_nothing() -> None:
    client, repo, storage, cloner = world()
    r = client.post(f"{B}/delete", headers=auth("a_owner"))
    assert r.status_code == 200 and r.json()["status"] == "none" and cloner.deleted == []
    client.post(B, json=body(), headers=auth("a_owner"))
    client.post(f"{B}/delete", headers=auth("a_owner"))
    again = client.post(f"{B}/delete", headers=auth("a_owner"))
    assert again.status_code == 200 and again.json()["status"] == "deleted" and len(cloner.deleted) == 1, "a second delete does nothing more"


def test_a_provider_that_cannot_be_reached_stops_the_deletion_before_anything_else_goes() -> None:
    client, repo, storage, cloner = world()
    client.post(B, json=body(), headers=auth("a_owner"))
    cloner.fail = "delete_unreachable"
    r = client.post(f"{B}/delete", headers=auth("a_owner"))
    assert r.status_code == 502 and r.json()["error"]["code"] == "voice_provider_unreachable"
    assert len(storage.files) == 2 and repo.row is not None and repo.row["status"] == "ready", "nothing changed: the Owner presses delete again"
    cloner.fail = None
    assert client.post(f"{B}/delete", headers=auth("a_owner")).json()["status"] == "deleted"


def test_recordings_that_cannot_be_removed_stop_the_record_from_saying_deleted() -> None:
    client, repo, storage, cloner = world()
    client.post(B, json=body(), headers=auth("a_owner"))
    storage.refuse_remove = True
    r = client.post(f"{B}/delete", headers=auth("a_owner"))
    assert r.status_code == 502 and r.json()["error"]["code"] == "recordings_not_removed"
    assert repo.row is not None and repo.row["status"] == "ready" and repo.row["name"] == NAME and ("deleted", None) not in repo.calls
    storage.refuse_remove = False
    assert client.post(f"{B}/delete", headers=auth("a_owner")).json()["status"] == "deleted" and storage.files == {}


# ------------------------------------------------------------------------------------------------ nothing leaks
def test_nothing_of_a_recording_or_a_name_is_logged(caplog: pytest.LogCaptureFixture) -> None:
    client, *_ = world()
    with caplog.at_level(logging.DEBUG):
        client.post(B, json=body(), headers=auth("a_owner"))
        client.get(B, headers=auth("a_admin"))
        client.post(f"{B}/delete", headers=auth("a_owner"))
        client.post(B, json=body(sample_type="image/png"), headers=auth("a_owner"))
    text = caplog.text
    for secret in (NAME, "Suresh", b64(SAMPLE)[:60], b64(CONSENT)[:60], "Sri Lakshmi"):
        assert secret not in text, secret


def test_no_answer_contains_a_recording_or_a_link() -> None:
    client, *_ = world()
    made = client.post(B, json=body(), headers=auth("a_owner")).text
    got = client.get(B, headers=auth("a_owner")).text
    for text in (made, got):
        assert b64(SAMPLE)[:40] not in text and "http" not in text and "signed" not in text.lower() and "sample.wav" not in text


def test_the_assistant_still_says_it_is_the_ai_assistant_whatever_the_voice() -> None:
    from app.assistant_settings import data

    for lang in ("en", "te", "hi", "kn"):
        text = data.intro(lang, "Vani", "Sri Lakshmi Silks")
        assert data.ASSISTANT_WORD[lang] in text and "AI" in text
    assert models.OwnVoiceOut(status="ready", languages=["en"]).says_ai_assistant is True


def test_the_postgrest_repository_maps_the_three_new_codes() -> None:
    from app.ownvoice import repository as r

    repo = PostgrestOwnVoiceRepository("http://x", "k")
    errors = repo._rpc._errors
    assert errors == {"SM831": r.VoiceExistsError, "SM832": r.RecordingMissingError, "SM833": r.SentenceMismatchError}


def test_no_module_of_the_model_side_imports_the_own_voice() -> None:
    import ast

    app = Path(__file__).resolve().parents[1] / "app"
    offenders = []
    for folder in ("agents", "agent_runs", "assistant", "followups", "outbox", "whatsapp", "campaigns", "scheduler"):
        for path in (app / folder).rglob("*.py"):
            for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
                if isinstance(node, ast.ImportFrom) and node.module and node.module.startswith("app.ownvoice"):
                    offenders.append(str(path.relative_to(app)))
    assert offenders == []
