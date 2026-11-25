"""What an adapter is. An adapter turns ONE record into the calls a tool documents (find the person, make or change them, add a note) and gives back one closed word. It never logs, never keeps a key, and never
puts the other side's words in its answer."""

# ruff: noqa: E501

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from app.crm_push.fields import NOTE, OUR_FIELDS, Record
from app.crm_push.transport import Answer, Http

OK_WORDS = ("created", "updated", "noted", "appended", "skipped")
# the closed words a failure can be (the database's CHECK list has them all)
FAIL_WORDS = ("auth", "rejected", "not_found", "rate_limited", "server", "bad_answer", "timeout", "refused", "tls", "redirect", "blocked", "dns", "too_large", "no_secret", "config")


@dataclass(frozen=True)
class Outcome:
    ok: bool
    word: str                    # created | updated | noted | appended | skipped, or a failure word
    status: int | None = None

    @property
    def retry(self) -> bool:
        """A bad record (rejected) or a record too big is not made better by waiting; everything else may be (a key can be replaced, a tool can come back)."""
        return not self.ok and self.word not in ("rejected", "too_large", "config")


def done(word: str, status: int | None = None) -> Outcome:
    return Outcome(True, word, status)


def failed(answer: Answer) -> Outcome:
    """A failed or unexpected answer as one closed word."""
    if answer.error is not None:
        return Outcome(False, answer.error)
    code = answer.status or 0
    if code in (401, 403):
        return Outcome(False, "auth", code)
    if code in (404, 410):
        return Outcome(False, "not_found", code)
    if code == 429:
        return Outcome(False, "rate_limited", code)
    if code >= 500:
        return Outcome(False, "server", code)
    if 300 <= code < 400:
        return Outcome(False, "redirect", code)
    if 400 <= code < 500:
        return Outcome(False, "rejected", code)
    return Outcome(False, "bad_answer", code)


@dataclass(frozen=True)
class Setting:
    """One labelled thing the business types to connect: a key (secret, never shown again) or a plain setting (shown back)."""

    key: str
    label: str
    secret: bool = False
    help: str = ""
    example: str = ""


@dataclass(frozen=True)
class Spec:
    key: str
    label: str
    kind: Literal["key", "oauth"]
    credentials: tuple[Setting, ...]
    settings: tuple[Setting, ...] = ()
    targets: tuple[tuple[str, str], ...] = ()          # the tool's fields the business can pick: (field name, label)
    our_fields: tuple[str, ...] = OUR_FIELDS
    default_mapping: dict[str, str] = field(default_factory=dict)
    notes: bool = True                                 # can the tool hold a note? (false: one row per event)
    docs: tuple[str, ...] = ()
    verify: tuple[str, ...] = ()                       # what needs a real account (shown to the owner as plain words in the contract, not in the app)
    needs_setup: str = ""                              # non-empty: the connect screen says "Needs setup by us" (OAuth client not registered yet); the words say why
    setup_steps: tuple[str, ...] = ()                  # what the business does in the other tool before pasting (plain words)


class Adapter:
    spec: Spec

    def check(self, creds: dict[str, str], config: dict[str, str]) -> str | None:
        """None when the settings are well formed, else a closed word ('config'). Cheap, no network."""
        return None

    def test(self, http: Http, creds: dict[str, str], config: dict[str, str], mapping: dict[str, str]) -> Outcome:
        raise NotImplementedError

    def push(self, http: Http, creds: dict[str, str], config: dict[str, str], mapping: dict[str, str], rec: Record) -> Outcome:
        raise NotImplementedError


def default_note_mapping(contact: dict[str, str]) -> dict[str, str]:
    """Contact fields as given, the call's own fields into the note."""
    return {**contact, "outcome": NOTE, "summary": NOTE, "captured": NOTE, "duration": NOTE, "call_id": NOTE}


def host_ok(host: str, suffixes: tuple[str, ...]) -> bool:
    h = host.lower().rstrip(".")
    return any(h == s.lstrip(".") or h.endswith(s if s.startswith(".") else "." + s) for s in suffixes)


def dig(value: Any, *path: str | int) -> Any:
    """value[path[0]][path[1]]... or None when any step is not there."""
    for step in path:
        if isinstance(step, int):
            if not isinstance(value, list) or len(value) <= step:
                return None
            value = value[step]
        else:
            if not isinstance(value, dict):
                return None
            value = value.get(step)
    return value


def first_id(value: Any) -> str | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int | str) and str(value):
        return str(value)
    return None


def first_num(value: Any) -> str | None:
    """A numeric id (digits only) as text, or None: the ids these tools use in a later call as a number."""
    got = first_id(value)
    return got if got is not None and got.isdigit() else None
