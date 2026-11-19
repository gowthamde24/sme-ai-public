"""Server-Timing (19 Nov 2026): where one request's time went, by function name and milliseconds only; off unless SERVER_TIMING_HEADERS."""

# ruff: noqa: E501

from __future__ import annotations

import re

import httpx

from app.hardening.observe import _TIMING, install_timing, server_timing_value


def test_the_value_names_the_whole_request_the_data_layer_sum_and_the_slowest_calls() -> None:
    value = server_timing_value(812.4, [("db", "today_summary", 300.2), ("db", "nav_counts", 90.0), ("upstream", "api_anthropic_com", 410.0)])
    assert value.startswith("app;dur=812, db;dur=390;desc=\"2 calls\", upstream;dur=410;desc=\"1 calls\"")
    assert "c1_api_anthropic_com;dur=410" in value and "c2_today_summary;dur=300" in value and "c3_nav_counts;dur=90" in value
    assert re.fullmatch(r"[A-Za-z0-9_;=,\". ]+", value), "only names and numbers: nothing from a request or an answer"


def test_installed_timing_measures_calls_by_where_they_went_and_costs_nothing_without_a_collector() -> None:
    install_timing()
    install_timing()   # twice is once
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json={}))
    with httpx.Client(transport=transport, base_url="http://data.test") as client:
        client.post("/rest/v1/rpc/today_summary", json={})   # no collector: untouched
        sink: list[tuple[str, str, float]] = []
        token = _TIMING.set(sink)
        try:
            client.post("/rest/v1/rpc/today_summary", json={})
            client.get("/other/place")
        finally:
            _TIMING.reset(token)
    assert [(kind, name) for kind, name, _ in sink] == [("db", "today_summary"), ("upstream", "data_test")]


def test_the_reads_a_bootstrap_makes_inside_the_process_are_named_by_route_and_the_slowest_is_the_one_waited_for() -> None:
    value = server_timing_value(900.0, [("part", "today", 700.0), ("part", "nav_counts", 120.0), ("part", "agents_status", 40.0)])
    assert 'parts;dur=700;desc="3 reads, slowest"' in value and "c1_today;dur=700" in value and "c2_nav_counts;dur=120" in value
