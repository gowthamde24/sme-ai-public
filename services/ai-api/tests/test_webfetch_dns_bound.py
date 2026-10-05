"""DNS lookups are bounded (T007 follow-up of the SSRF review).

`getaddrinfo` cannot be cancelled. The first version started a new thread pool per lookup, so
a name server that never answers made the process grow one stuck thread per request. Now: a
fixed number of lookup threads, a slot released only when the lookup itself ends, and a refusal
(`resolver_busy`) instead of a queue when no slot is free."""

from __future__ import annotations

import threading
import time
from collections.abc import Iterator

import pytest

from app.agents.web import FetchError
from app.webfetch.fetcher import FetchConfig, SafeFetcher, _BoundedResolver
from app.webfetch.limits import Deadline


class Hanging:
    """A resolver that blocks until released, and counts how many lookups are running."""

    def __init__(self) -> None:
        self.release = threading.Event()
        self.started = threading.Semaphore(0)
        self.running = 0
        self._lock = threading.Lock()

    def __call__(self, host: str, port: int) -> list[str]:
        with self._lock:
            self.running += 1
        self.started.release()
        self.release.wait(timeout=20)
        with self._lock:
            self.running -= 1
        return ["93.184.216.34"]


def dns_threads() -> int:
    return sum(1 for t in threading.enumerate() if t.name.startswith("dns"))


@pytest.fixture
def hanging() -> Iterator[Hanging]:
    h = Hanging()
    yield h
    h.release.set()  # never leave a thread behind


def test_a_lookup_that_finishes_returns_its_answer_and_frees_its_slot() -> None:
    bounded = _BoundedResolver(lambda host, port: ["93.184.216.34"], 1)
    for _ in range(5):  # one slot, five sequential lookups: the slot is released each time
        assert bounded.lookup("a.example.net", 443, Deadline(5)) == ["93.184.216.34"]


def test_stuck_lookups_cannot_create_more_threads_than_slots(hanging: Hanging) -> None:
    bounded = _BoundedResolver(hanging, 3)
    before = dns_threads()
    codes = []
    for _ in range(60):  # every caller gives up after 50 ms; the lookups themselves never end
        try:
            bounded.lookup("slow.example.net", 443, Deadline(0.05))
        except FetchError as exc:
            codes.append(exc.code)
    assert codes.count("timeout") == 3, "only the first three lookups ever started"
    assert codes.count("resolver_busy") == 57, "the others were refused at once"
    assert hanging.running == 3 and dns_threads() - before <= 3


def test_a_refusal_is_immediate_not_a_wait(hanging: Hanging) -> None:
    bounded = _BoundedResolver(hanging, 1)
    with pytest.raises(FetchError) as first:
        bounded.lookup("slow.example.net", 443, Deadline(0.05))
    assert first.value.code == "timeout"
    started = time.monotonic()
    with pytest.raises(FetchError) as second:
        bounded.lookup("other.example.net", 443, Deadline(30))
    assert second.value.code == "resolver_busy" and time.monotonic() - started < 0.5


def test_a_slot_is_freed_only_when_the_lookup_ends_not_when_the_caller_gives_up(
    hanging: Hanging,
) -> None:
    bounded = _BoundedResolver(hanging, 1)
    with pytest.raises(FetchError):
        bounded.lookup("slow.example.net", 443, Deadline(0.05))  # gave up: timeout
    with pytest.raises(FetchError) as busy:
        bounded.lookup("slow.example.net", 443, Deadline(0.05))
    assert busy.value.code == "resolver_busy", "the abandoned lookup still holds the slot"
    hanging.release.set()
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        try:
            bounded.lookup("fast.example.net", 443, Deadline(2))
            return
        except FetchError:
            time.sleep(0.02)
    pytest.fail("the slot was never freed after the lookup ended")


def test_a_resolver_failure_is_one_constant_code_and_frees_the_slot() -> None:
    def boom(host: str, port: int) -> list[str]:
        raise OSError("SECRET-detail")

    bounded = _BoundedResolver(boom, 1)
    for _ in range(3):
        with pytest.raises(FetchError) as caught:
            bounded.lookup("x.example.net", 443, Deadline(2))
        assert caught.value.code == "resolve_failed" and "SECRET" not in str(caught.value)


def test_the_slot_count_must_be_positive() -> None:
    with pytest.raises(ValueError, match="at least one"):
        _BoundedResolver(lambda h, p: [], 0)


def test_the_fetcher_uses_the_bound_end_to_end(hanging: Hanging) -> None:
    fetcher = SafeFetcher(
        FetchConfig(total_timeout=0.2, min_interval=0.0, max_dns_lookups=2),
        resolver=hanging,
    )
    codes = []
    for _ in range(20):
        with pytest.raises(FetchError) as caught:
            fetcher.fetch("https://slow.example.net/", allowed_hosts=None)
        codes.append(caught.value.code)
    # robots.txt goes through the same lookups: only the two bounded lookups ever ran
    assert hanging.running <= 2
    assert set(codes) <= {"timeout", "resolver_busy", "robots_unavailable"}
    assert "resolver_busy" in codes or hanging.running <= 2
    assert dns_threads() <= 2 + 4, "a fixed pool, whatever the number of requests"
