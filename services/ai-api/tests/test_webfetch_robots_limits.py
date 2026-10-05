"""robots rules and the per-host limiter, as units (the fetcher tests cover them end to end)."""

from __future__ import annotations

import pytest

from app.agents.web import FetchError
from app.webfetch.limits import Deadline, HostLimiter
from app.webfetch.robots import ALLOW_ALL, DENY_ALL, parse_robots


def test_the_two_constant_rule_sets() -> None:
    assert ALLOW_ALL.allows("/anything") and ALLOW_ALL.crawl_delay() == 0.0
    assert (
        not DENY_ALL.allows("/")
        and not DENY_ALL.allows("/anything")
        and DENY_ALL.crawl_delay() == 0.0
    )
    assert DENY_ALL.unavailable and not ALLOW_ALL.unavailable


@pytest.mark.parametrize(
    ("text", "path", "ok"),
    [
        ("User-agent: *\nDisallow: /private\n", "/private/x", False),
        ("User-agent: *\nDisallow: /private\n", "/public", True),
        ("User-agent: *\nDisallow:\n", "/anything", True),
        ("User-agent: *\nDisallow: /\n", "/", False),
        ("User-agent: SmeAiResearchBot\nDisallow: /\n\nUser-agent: *\nDisallow:\n", "/x", False),
        ("User-agent: smeairesearchbot\nDisallow: /\n", "/x", False),
        ("User-agent: OtherBot\nDisallow: /\n", "/x", True),
        ("", "/x", True),
        ("# only a comment\n", "/x", True),
    ],
)
def test_parsed_rules_decide_for_our_crawler(text: str, path: str, ok: bool) -> None:
    assert parse_robots(text).allows(path) is ok


def test_crawl_delay_is_read_for_our_crawler() -> None:
    assert parse_robots("User-agent: *\nCrawl-delay: 4\n").crawl_delay() == 4.0
    assert parse_robots("User-agent: SmeAiResearchBot\nCrawl-delay: 7\n").crawl_delay() == 7.0
    assert parse_robots("User-agent: OtherBot\nCrawl-delay: 7\n").crawl_delay() == 0.0
    assert parse_robots("User-agent: *\nDisallow:\n").crawl_delay() == 0.0


class Clock:
    def __init__(self) -> None:
        self.now = 100.0
        self.slept: list[float] = []

    def __call__(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)
        self.now += seconds


def limiter(clock: Clock, **kw: float) -> HostLimiter:
    return HostLimiter(
        min_interval=kw.get("min_interval", 2.0),
        daily_cap=int(kw.get("daily_cap", 3)),
        clock=clock,
        sleep=clock.sleep,
        wall=clock,
    )


def test_spacing_per_host() -> None:
    clock = Clock()
    lim = limiter(clock)
    deadline = Deadline(100)
    lim.acquire("a.example.net", deadline)
    assert clock.slept == []  # the first request to a host never waits
    lim.acquire("a.example.net", deadline)
    assert clock.slept == [2.0]
    lim.acquire("b.example.net", deadline)
    assert clock.slept == [2.0]  # another host is independent
    clock.now += 1.5
    lim.acquire("a.example.net", deadline)
    assert clock.slept[-1] == pytest.approx(0.5)  # only the remainder is waited
    lim.acquire("a.example.net", deadline, extra_delay=5.0)
    assert clock.slept[-1] == pytest.approx(5.0)  # the site's crawl delay widens it


def test_a_wait_the_deadline_cannot_cover_is_refused() -> None:
    clock = Clock()
    lim = limiter(clock, min_interval=1000.0)
    lim.acquire("a.example.net", Deadline(5))
    with pytest.raises(FetchError) as caught:
        lim.acquire("a.example.net", Deadline(5))
    assert caught.value.code == "rate_limited" and clock.slept == []


def test_the_daily_cap_counts_pages_in_a_sliding_day() -> None:
    clock = Clock()
    lim = limiter(clock, daily_cap=2)
    for _ in range(2):
        lim.check_daily("a.example.net")
        lim.record_page("a.example.net")
        clock.now += 10
    with pytest.raises(FetchError) as caught:
        lim.check_daily("a.example.net")
    assert caught.value.code == "daily_limit"
    lim.check_daily("b.example.net")  # per host
    clock.now += 86_400 - 20 + 1  # the first page has now left the window
    lim.check_daily("a.example.net")


def test_an_expired_deadline_raises_a_timeout() -> None:
    deadline = Deadline(0.0)
    assert deadline.exceeded()
    with pytest.raises(FetchError) as caught:
        deadline.remaining()
    assert caught.value.code == "timeout"
    assert not Deadline(60).exceeded() and 0 < Deadline(60).remaining() <= 60
