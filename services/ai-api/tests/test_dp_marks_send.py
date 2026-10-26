"""Job DP part 2 (owner decision: the platform never stores children's marks): a school uploads a marks file for ONE send; the API checks it, shows counts, the Owner approves, it is sent (FAKE), only a send log
is kept (guardian, time, template id, status), and the file is gone with the request. Tests: the contract, the preview, the approval, every path that must not keep or leak the file, the roles, and the
structural proof that nothing that can talk to a model reads the file or the template values (and that this module touches nothing that can). The database's own rules are in 119_dp_marks_send_log.test.sql."""

# ruff: noqa: E501

from __future__ import annotations

import ast
import builtins
import json
import logging
import pathlib
import tempfile
import uuid
from pathlib import Path
from typing import Any

import jsonschema
import pytest

from app.education import progress
from app.integrations.xlsx import write_xlsx
from app.marksmessages import contracts, models, reader
from app.marksmessages.sender import FakeGuardianSender, SendRefused, SendUnreachable
from app.marksmessages.service import MarksSendService, school_name
from tests.dp_fakes import FakeMarksSendRepository
from tests.fakes import TENANT_A, auth, make_client

APP = Path(__file__).resolve().parents[1] / "app"
CONTRACTS = Path(__file__).resolve().parents[3] / "packages" / "contracts"
SCHEMA = json.loads((CONTRACTS / "marks_messages.schema.json").read_text())
EXAMPLES = json.loads((CONTRACTS / "marks_messages.examples.json").read_text())
A = TENANT_A.id
B = f"/v1/tenants/{A}/institution/marks-messages"
SHA = "0" * 64
HEADER = "Phone,Student,Subject,Marks,Out of,Term\n"
CHILD_WORDS = ("Ravi", "Meena", "Zainab", "Kiran")


def csv(*rows: str, header: str = HEADER) -> bytes:
    return (header + "".join(r + "\n" for r in rows)).encode()


def world(*, school: bool = True) -> tuple[Any, FakeMarksSendRepository, FakeGuardianSender, MarksSendService]:
    repo = FakeMarksSendRepository(school=school)
    repo.guardian("9000000001")
    repo.guardian("9000000002")
    repo.guardian("9000000003", blocked="suppressed")
    sender = FakeGuardianSender()
    service = MarksSendService(repo, sender)
    client, _ = make_client(marks_messages=service)
    return client, repo, sender, service


GOOD = csv("9000000001,Ravi,Maths,42,50,Term 1", "9000000002,Meena,Science,38.5,40,Term 1", "9000000003,Zainab,Maths,30,50,Term 1", "9000000004,Kiran,Maths,20,50,Term 1", "98765,Ravi,Maths,abc,50,Term 1",
           "9000000001,Ravi,Maths,42,50,Term 1")


def preview(client: Any, data: bytes = GOOD, user: str = "a_owner", **params: Any) -> Any:
    return client.post(f"{B}/preview", params={"kind": "marks", **params}, content=data, headers=auth(user))


def send(client: Any, data: bytes = GOOD, user: str = "a_owner", batch: str | None = None, sha: str | None = None, count: int | None = None, **params: Any) -> Any:
    if sha is None or count is None:
        shown = preview(client, data, **{k: v for k, v in params.items() if k != "aal"}).json()
        sha, count = shown["file_sha256"], shown["will_send"]
    query = {"kind": "marks", "batch_id": batch or str(uuid.uuid4()), "expect_sha256": sha, "expect_count": count, **params}
    return client.post(f"{B}/send", params=query, content=data, headers=auth(user))


# ------------------------------------------------------------------------------------------------ the contract
def test_the_schema_and_the_typescript_are_up_to_date() -> None:
    assert (CONTRACTS / "marks_messages.schema.json").read_text() == contracts.schema_text(), "run `make contracts`"
    assert (CONTRACTS / "marks_messages.ts").read_text() == contracts.ts_text(), "run `make contracts`"


def test_every_shape_forbids_unknown_properties_and_names_no_child() -> None:
    for name, node in SCHEMA["$defs"].items():
        if "properties" in node:
            assert node.get("additionalProperties") is False, name
    names = {p.lower() for node in SCHEMA["$defs"].values() for p in node.get("properties", {})} | {n.lower() for n in SCHEMA["$defs"]}
    assert not [n for n in names if any(w in n for w in ("student", "child", "pupil", "marks_value", "grade", "subject"))], names


@pytest.mark.parametrize(("example", "model"), [("templates", models.TemplatesOut), ("preview", models.PreviewOut), ("preview_with_problems", models.PreviewOut), ("send_result", models.SendOut),
                                                ("batches", models.BatchesOut), ("batch", models.BatchOut)])
def test_the_example_payloads_match_the_models_and_the_schema(example: str, model: type) -> None:
    payload = EXAMPLES[example]
    model.model_validate(payload)  # type: ignore[attr-defined]
    jsonschema.validate(payload, {**SCHEMA, "$ref": f"#/$defs/{model.__name__}"})


def test_the_log_shape_holds_no_marks_name_subject_term_or_text() -> None:
    for model in (models.BatchLineOut, models.LogRowOut, models.BatchOut):
        for field in model.model_fields:
            assert field not in ("marks", "student", "child", "subject", "term", "text", "message", "body", "out_of", "name"), (model.__name__, field)


# ------------------------------------------------------------------------------------------------ the templates
def test_templates_show_every_fixed_message_in_every_language_and_the_columns() -> None:
    client, *_ = world()
    out = client.get(f"{B}/templates", headers=auth("a_owner")).json()
    assert [t["template_id"] for t in out["templates"]] == [f"{k}.{lang}" for k in progress.KINDS for lang in progress.LANGUAGES]
    assert all("{" not in t["example_text"] for t in out["templates"])
    assert out["max_rows"] == 5000
    assert client.get(f"{B}/templates", headers=auth("a_sales")).status_code == 403


# ------------------------------------------------------------------------------------------------ the preview
def test_the_preview_counts_what_will_be_sent_and_why_a_line_will_not() -> None:
    client, repo, sender, _ = world()
    out = preview(client).json()
    assert (out["rows"], out["will_send"], out["blocked"], out["unknown_guardian"], out["invalid"], out["duplicates"]) == (6, 2, 1, 1, 1, 1)
    assert out["by_template"] == {"marks.en": 2}
    assert {(i["line"], i["code"], i["field"]) for i in out["issues"]} == {(4, "blocked_guardian", None), (5, "unknown_guardian", None), (6, "bad_value", "marks"), (7, "duplicate_row", None)}
    assert out["example_text"] == "Ravi scored 42 out of 50 in Maths (Term 1). - Tenant A"
    assert sender.sent == 0, "a preview sends nothing"
    assert repo.log == {}, "a preview writes nothing"


def test_the_preview_answer_has_the_childs_words_only_in_the_one_example_line() -> None:
    client, *_ = world()
    out = preview(client).json()
    out.pop("example_text")
    text = json.dumps(out)
    for word in (*CHILD_WORDS, "Maths", "Science", "9000000001", "42"):
        assert word not in text, word


def test_an_xlsx_file_works_like_a_csv() -> None:
    client, *_ = world()
    book = write_xlsx([("Marks", [["Phone", "Student", "Subject", "Marks", "Out of", "Term"], ["9000000001", "Ravi", "Maths", 42, 50, "Term 1"]])])
    out = preview(client, book).json()
    assert (out["rows"], out["will_send"]) == (1, 1)


def test_headers_in_other_words_and_a_term_for_the_whole_file_are_accepted() -> None:
    client, *_ = world()
    data = csv("9000000001,Ravi,Maths,42,50", header="WhatsApp number,Child,Subject,Marks obtained,Max marks\n")
    out = preview(client, data, term="Term 2").json()
    assert out["will_send"] == 1 and out["example_text"] is not None and "Term 2" in out["example_text"]


def test_a_line_can_name_its_own_language_and_the_template_follows() -> None:
    client, *_ = world()
    data = csv("9000000001,Ravi,Maths,42,50,Term 1,te", "9000000002,Meena,Maths,40,50,Term 1", header=HEADER.strip() + ",Language\n")
    out = preview(client, data, language="hi").json()
    assert out["by_template"] == {"marks.hi": 1, "marks.te": 1}


def test_report_ready_needs_only_the_phone_and_the_child() -> None:
    client, *_ = world()
    out = client.post(f"{B}/preview", params={"kind": "report_ready", "term": "Term 1"}, content=csv("9000000001,Ravi", header="Phone,Student\n"), headers=auth("a_owner")).json()
    assert out["will_send"] == 1 and out["by_template"] == {"report_ready.en": 1}


@pytest.mark.parametrize(
    ("data", "params", "status", "code"),
    [
        (b"", {}, 422, "marks_file_empty"),
        (b"\x00\x01\x02 not a sheet", {}, 422, None),
        (csv("9000000001,Ravi,Maths,42,50,Term 1", header="Phone,Student,Subject,Marks\n"), {}, 422, "marks_file_missing_column"),
        (csv("9000000001,Ravi,Maths,42,50", header="Phone,Student,Subject,Marks,Out of\n"), {}, 422, "marks_file_missing_column"),
        (b"x" * 3_100_000, {}, 413, "marks_file_too_large"),
    ],
)
def test_a_file_that_cannot_be_used_is_refused_with_a_closed_code_and_no_echo(data: bytes, params: dict[str, str], status: int, code: str | None) -> None:
    client, repo, sender, _ = world()
    r = preview(client, data, **params)
    assert r.status_code == status
    if code:
        assert r.json()["error"]["code"] == code
    assert "Ravi" not in r.text and sender.sent == 0 and repo.log == {}


def test_the_missing_columns_are_named_not_the_cells() -> None:
    client, *_ = world()
    r = preview(client, csv("9000000001,Ravi", header="Phone,Student\n"))
    assert r.status_code == 422
    assert "subject, marks, out_of, term" in r.json()["error"]["message"] and "Ravi" not in r.text


def test_marks_above_the_maximum_and_unsafe_names_are_reported_by_line_and_field() -> None:
    client, *_ = world()
    data = csv("9000000001,Ravi,Maths,60,50,Term 1", "9000000002,<b>Meena</b>,Maths,40,50,Term 1", "9000000001,Ravi,Maths,=1+1,50,Term 1")
    out = preview(client, data).json()
    assert out["will_send"] == 0 and out["invalid"] == 3
    assert {(i["line"], i["field"]) for i in out["issues"]} == {(2, "marks"), (3, "student"), (4, "marks")}


# ------------------------------------------------------------------------------------------------ the approval and the send
def test_the_owner_approves_and_the_messages_go_and_only_the_log_is_kept() -> None:
    client, repo, sender, _ = world()
    batch = str(uuid.uuid4())
    r = send(client, batch=batch)
    assert r.status_code == 200, r.text
    out = r.json()
    assert (out["sent"], out["failed"], out["blocked"], out["already_handled"], out["skipped"], out["file_kept"]) == (2, 0, 1, 0, 3, False)
    assert sender.sent == 2 and {t for _, t in sender.calls} == {"marks.en"}
    rows = list(repo.log.values())
    assert sorted(r["status"] for r in rows) == ["blocked", "sent", "sent"]
    assert all(set(r) == {"seq", "contact_id", "guardian_name", "template_id", "status", "reason", "sent_at", "created_at"} for r in rows)


def test_nothing_with_a_childs_name_or_marks_ever_reaches_the_database_layer() -> None:
    client, repo, *_ = world()
    assert send(client).status_code == 200
    dump = json.dumps([c for c in repo.calls if c[0] in ("begin", "finish")], default=str)
    for word in (*CHILD_WORDS, "Maths", "Science", "Term 1", "38.5", "9000000001"):
        assert word not in dump, word
    for name, args in repo.calls:
        if name == "begin":
            assert all(set(i) == {"seq", "contact_id", "template_id"} for i in args), "only a line number, a guardian and a template id"
        if name == "finish":
            assert all(set(i) <= {"seq", "status", "reason"} for i in args)
    assert json.dumps([c[1] for c in repo.calls if c[0] == "begin"], default=str).count("marks.en") == 3


def test_a_different_file_or_a_changed_count_is_refused_and_nothing_is_sent() -> None:
    client, repo, sender, _ = world()
    shown = preview(client).json()
    other = csv("9000000001,Ravi,Maths,43,50,Term 1")
    r = send(client, other, sha=shown["file_sha256"], count=shown["will_send"])
    assert r.status_code == 409 and r.json()["error"]["code"] == "marks_file_changed"
    r = send(client, GOOD, sha=shown["file_sha256"], count=shown["will_send"] + 1)
    assert r.status_code == 409 and r.json()["error"]["code"] == "marks_count_changed"
    assert sender.sent == 0 and repo.log == {}


def test_a_guardian_who_opts_out_after_the_preview_stops_the_send() -> None:
    client, repo, sender, _ = world()
    shown = preview(client).json()
    repo.guardians = {k: (c, "suppressed") for k, (c, _) in repo.guardians.items()}
    r = send(client, GOOD, sha=shown["file_sha256"], count=shown["will_send"])
    assert r.status_code == 409 and r.json()["error"]["code"] == "marks_count_changed"
    assert sender.sent == 0


def test_the_same_batch_again_sends_no_line_twice() -> None:
    client, repo, sender, _ = world()
    batch = str(uuid.uuid4())
    assert send(client, batch=batch).json()["sent"] == 2
    again = send(client, batch=batch).json()
    assert (again["sent"], again["already_handled"]) == (0, 3)
    assert sender.sent == 2 and len(repo.log) == 3


def test_a_refusing_or_broken_channel_is_logged_as_failed_and_the_rest_still_go() -> None:
    client, repo, _, service = world()

    class Flaky:
        def __init__(self) -> None:
            self.n = 0

        def send(self, tenant_id: uuid.UUID, contact_id: uuid.UUID, template_id: str, text: str) -> None:
            self.n += 1
            if self.n == 1:
                raise SendRefused
            if self.n == 2:
                raise SendUnreachable
            raise RuntimeError("secret words of the channel")

    service._sender = Flaky()
    data = csv("9000000001,Ravi,Maths,42,50,Term 1", "9000000002,Meena,Maths,40,50,Term 1")
    out = send(client, data).json()
    assert (out["sent"], out["failed"]) == (0, 2)
    assert sorted(r["reason"] for r in repo.log.values()) == ["provider_refused", "provider_unreachable"]


def test_only_the_owner_with_a_second_factor_approves_and_a_preview_is_the_owners_or_an_admins() -> None:
    client, repo, sender, _ = world()
    shown = preview(client).json()
    args = {"sha": shown["file_sha256"], "count": shown["will_send"]}
    for user, status in (("a_admin", 403), ("a_sales", 403), ("a_viewer", 403), ("outsider", 404), ("b_owner", 404)):
        assert send(client, GOOD, user=user, **args).status_code == status, user
    low = client.post(f"{B}/send", params={"kind": "marks", "batch_id": str(uuid.uuid4()), "expect_sha256": shown["file_sha256"], "expect_count": shown["will_send"]}, content=GOOD, headers=auth("a_owner", aal="aal1"))
    assert low.status_code == 403 and low.json()["error"]["code"] == "mfa_required"
    for user, status in (("a_admin", 200), ("a_sales", 403), ("a_viewer", 403), ("outsider", 404), ("b_owner", 404)):
        assert preview(client, user=user).status_code == status, user
    assert sender.sent == 0 and repo.log == {}


def test_only_a_school_can_use_it() -> None:
    client, repo, sender, _ = world(school=False)
    assert preview(client).status_code == 403 and preview(client).json()["error"]["code"] == "module_off"
    assert send(client, sha=SHA, count=1).status_code == 403
    assert client.get(f"{B}/batches", headers=auth("a_owner")).status_code == 403
    assert sender.sent == 0 and repo.log == {}


def test_bad_query_values_are_refused() -> None:
    client, *_ = world()
    q = {"kind": "marks", "batch_id": "not-a-uuid", "expect_sha256": SHA, "expect_count": 1}
    assert client.post(f"{B}/send", params=q, content=GOOD, headers=auth("a_owner")).status_code == 422
    assert client.post(f"{B}/send", params={**q, "batch_id": str(uuid.uuid4()), "expect_sha256": "abc"}, content=GOOD, headers=auth("a_owner")).status_code == 422
    assert client.post(f"{B}/preview", params={"kind": "grades"}, content=GOOD, headers=auth("a_owner")).status_code == 422
    assert client.post(f"{B}/preview", params={"kind": "marks", "language": "fr"}, content=GOOD, headers=auth("a_owner")).status_code == 422


# ------------------------------------------------------------------------------------------------ the log
def test_the_send_log_lists_batches_and_one_batch_with_no_marks_in_it() -> None:
    client, _, _, _ = world()
    batch = str(uuid.uuid4())
    send(client, batch=batch)
    listing = client.get(f"{B}/batches", headers=auth("a_admin")).json()
    assert listing["items"][0]["batch_id"] == batch and (listing["items"][0]["sent"], listing["items"][0]["blocked"]) == (2, 1)
    one = client.get(f"{B}/batches/{batch}", headers=auth("a_owner"))
    assert one.status_code == 200
    text = json.dumps(one.json())
    for word in (*CHILD_WORDS, "Maths", "Term 1", "42", "50"):
        assert f'"{word}"' not in text and f"{word} " not in text, word
    assert client.get(f"{B}/batches/{uuid.uuid4()}", headers=auth("a_owner")).status_code == 404
    assert client.get(f"{B}/batches/nope", headers=auth("a_owner")).status_code == 404
    assert client.get(f"{B}/batches", headers=auth("a_sales")).status_code == 403


# ------------------------------------------------------------------------------------------------ the file is never kept
def test_no_path_writes_a_file_or_keeps_one(monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture) -> None:
    client, repo, sender, service = world()

    def refuse(*a: Any, **k: Any) -> Any:
        raise AssertionError("the marks file must never be written to disk")

    real_open = builtins.open
    monkeypatch.setattr(builtins, "open", lambda f, mode="r", *a, **k: refuse() if any(c in mode for c in "wax+") else real_open(f, mode, *a, **k))
    for name in ("NamedTemporaryFile", "TemporaryFile", "SpooledTemporaryFile", "mkstemp", "mkdtemp", "TemporaryDirectory"):
        monkeypatch.setattr(tempfile, name, refuse)
    monkeypatch.setattr(pathlib.Path, "write_bytes", refuse)
    monkeypatch.setattr(pathlib.Path, "write_text", refuse)
    with caplog.at_level(logging.DEBUG):
        batch = str(uuid.uuid4())
        assert preview(client).status_code == 200
        assert send(client, batch=batch).status_code == 200
        assert preview(client, b"garbage \x00").status_code == 422  # a refused file
        assert send(client, GOOD, sha=SHA, count=1, batch=batch).status_code == 409  # a cancelled/changed approval
    # the service holds nothing but its two collaborators: no file, no text, no cache
    assert set(vars(service)) == {"_repo", "_sender"}
    assert not any(isinstance(v, (bytes, bytearray, str, list, dict)) for v in vars(service).values())
    # and nothing it logged carries a child's name, a mark, a subject, a number or a message
    logged = "\n".join(r.getMessage() for r in caplog.records)
    for word in (*CHILD_WORDS, "Maths", "Science", "Term 1", "9000000001", "scored"):
        assert word not in logged, word
    assert sender.sent == 2 and repo.log


def test_the_service_has_no_storage_a_path_or_a_clock_to_hold_a_file_with() -> None:
    import inspect

    params = set(inspect.signature(MarksSendService.__init__).parameters) - {"self"}
    assert params == {"repo", "sender"}
    assert not [m for m in dir(MarksSendService) if any(w in m.lower() for w in ("store", "save", "cache", "hold", "keep", "upload", "expire", "sweep"))]


def test_the_fake_sender_keeps_no_words() -> None:
    sender = FakeGuardianSender()
    sender.send(A, uuid.uuid4(), "marks.en", "Ravi scored 42 out of 50")
    assert "Ravi" not in json.dumps(vars(sender), default=str)


def test_the_school_name_in_a_message_is_made_safe() -> None:
    assert school_name("St. Mary's <High> School & Co") == "St. Mary's High School Co"
    assert school_name("<>") == "School"
    assert len(school_name("x" * 200)) == progress.LIMITS["school"]


# ------------------------------------------------------------------------------------------------ nothing on the model side touches it
def _imports(path: Path) -> set[str]:
    out: set[str] = set()
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if isinstance(node, ast.Import):
            out |= {a.name for a in node.names}
        elif isinstance(node, ast.ImportFrom) and node.module:
            out.add(node.module)
    return out


MODEL_SIDE = ("anthropic", "openai", "httpx", "requests", "urllib", "socket", "app.agents", "app.agent_runs", "app.assistant", "app.voice", "app.voice_notes", "app.llm", "app.followups.builder", "app.outbox", "app.whatsapp")


def test_the_module_imports_nothing_that_talks_to_a_model_a_speech_engine_or_the_network() -> None:
    for path in (APP / "marksmessages").glob("*.py"):
        if path.name == "repository.py":
            assert {i for i in _imports(path) if i.startswith("app.")} <= {"app.packs.errors", "app.rpc_base"}, "the database door imports only the RPC client"
            continue
        bad = sorted(i for i in _imports(path) if any(i == m or i.startswith(m + ".") for m in MODEL_SIDE))
        assert bad == [], (path.name, bad)


def test_nothing_on_the_model_side_imports_the_module() -> None:
    offenders = []
    for folder in ("agents", "agent_runs", "assistant", "assistant_settings", "voice", "voice_notes", "followups", "outbox", "whatsapp", "scheduler", "campaigns", "outcomes"):
        for path in (APP / folder).rglob("*.py"):
            if any(i.startswith("app.marksmessages") for i in _imports(path)):
                offenders.append(str(path.relative_to(APP)))
    assert offenders == [], offenders


def test_the_assistant_has_no_tool_that_can_reach_the_marks_messages() -> None:
    from app.assistant.tools import TOOLS

    names = " ".join(t.name for t in TOOLS)
    assert len(TOOLS) > 10
    for word in ("marks", "mark_", "progress", "report_ready", "send_marks", "guardian_message"):
        assert word not in names, word


def test_no_model_facing_text_is_built_from_the_module_or_its_templates() -> None:
    for folder in ("agents", "agent_runs", "assistant", "followups", "voice_notes"):
        for path in (APP / folder).rglob("*.py"):
            text = path.read_text(encoding="utf-8")
            assert "marksmessages" not in text and "progress.render" not in text, path.name


def test_only_the_runtime_wiring_and_the_routes_use_the_service() -> None:
    users = sorted(str(p.relative_to(APP)) for p in APP.rglob("*.py") if p.parts[-2] != "marksmessages" and any(i.startswith("app.marksmessages") for i in _imports(p)))
    assert users == ["auth/deps.py", "main.py"], users


def test_the_reader_is_pure_and_keeps_no_state_between_calls() -> None:
    first = reader.read(GOOD, "marks", "en", None)
    second = reader.read(GOOD, "marks", "en", None)
    assert first == second
    state = {k: v for k, v in vars(reader).items() if isinstance(v, (list, dict, set, bytearray)) and not k.startswith("__")}
    assert set(state) == {"ALIASES", "REQUIRED"}, "only the closed header words live at module level"
