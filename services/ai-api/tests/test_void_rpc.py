# ruff: noqa: E501
"""A database function that returns nothing (`assistant_mark_heavy`) answers with an empty body. That is success. It used to be read as "the data layer is unavailable", which crashed every turn that
opened as small talk and turned out to read or change the business (owner, 14 Nov 2026: "Just ask, how is she?" after a question)."""

from __future__ import annotations

import uuid

import httpx

from app.assistant.db import AssistantDb

RUN = uuid.UUID("11111111-1111-4111-8111-111111111111")


def test_an_empty_answer_from_a_void_function_is_success() -> None:
    seen: list[httpx.Request] = []

    def server(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(204)

    client = httpx.Client(base_url="http://rest.test/rest/v1", transport=httpx.MockTransport(server))
    db = AssistantDb("http://rest.test/rest/v1", "anon-key", "TOKEN", RUN, client=client)
    db.mark_heavy()
    assert seen and seen[0].url.path.endswith("/rpc/assistant_mark_heavy")
