"""The one real model adapter: the Anthropic Messages API over httpx. Nothing provider-specific
exists outside this file.

Off unless configured (the wiring needs a model id, a key, the prices and the owner's
spend-cap confirmation); every test uses httpx.MockTransport. The adapter puts our own
constant policy text in the `system` field and everything else, with the untrusted block LAST,
in the user turn. It makes one request per call (no retries), maps every provider failure to a
constant code, and never puts the key, the URL, the request or the response body into an
exception or a log line."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

import httpx

from app.agents.llm.interface import (
    LlmBadResponse,
    LlmRateLimited,
    LlmRejected,
    LlmRequest,
    LlmResponse,
    LlmTimeout,
    LlmUnavailable,
    ToolCall,
    Trust,
    Usage,
)

logger = logging.getLogger("app.agents.llm.anthropic")

API_VERSION = "2023-06-01"
DEFAULT_BASE_URL = "https://api.anthropic.com"


@dataclass(frozen=True)
class AnthropicConfig:
    api_key: str = field(repr=False)
    model: str
    input_micros_per_mtok: int
    output_micros_per_mtok: int
    base_url: str = DEFAULT_BASE_URL
    timeout_seconds: float = 30.0

    def __post_init__(self) -> None:
        if not self.api_key.strip() or not self.model.strip():
            raise ValueError("an API key and a model id are required")
        if self.input_micros_per_mtok < 0 or self.output_micros_per_mtok < 0:
            raise ValueError("prices must not be negative")
        if self.timeout_seconds <= 0:
            raise ValueError("the timeout must be positive")
        if not self.base_url.startswith("https://"):
            raise ValueError("the base URL must use https")


def _count(value: Any) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise LlmBadResponse
    return value


class AnthropicClient:
    def __init__(self, config: AnthropicConfig, *, client: httpx.Client | None = None) -> None:
        self._config = config
        self._client = client or httpx.Client()

    def __repr__(self) -> str:
        return f"AnthropicClient(model={self._config.model})"

    # ------------------------------------------------------------------ request
    def _payload(self, request: LlmRequest) -> dict[str, Any]:
        system = "\n\n".join(b.text for b in request.blocks if b.trust is Trust.SYSTEM)
        trusted = [b.text for b in request.blocks if b.trust is Trust.TRUSTED]
        untrusted = [b.text for b in request.blocks if b.trust is Trust.UNTRUSTED]
        parts = [{"type": "text", "text": text} for text in (*trusted, *untrusted)]
        tools = [
            {"name": t.name, "description": t.description, "input_schema": t.input_schema}
            for t in (*request.tools, *([request.final_result] if request.final_result else []))
        ]
        payload: dict[str, Any] = {
            "model": self._config.model,
            "max_tokens": request.max_output_tokens,
            "messages": [{"role": "user", "content": parts}],
            "tools": tools,
            "tool_choice": {"type": "auto"},
        }
        if system:
            payload["system"] = system
        return payload

    def complete(self, request: LlmRequest) -> LlmResponse:
        try:
            response = self._client.post(
                f"{self._config.base_url}/v1/messages",
                headers={
                    "x-api-key": self._config.api_key,
                    "anthropic-version": API_VERSION,
                    "content-type": "application/json",
                },
                json=self._payload(request),
                timeout=self._config.timeout_seconds,
            )
        except httpx.TimeoutException:
            logger.warning("anthropic call timed out")
            raise LlmTimeout from None
        except httpx.HTTPError as exc:
            # the text of a transport error can contain the URL and the headers: the class
            # only
            logger.warning("anthropic call failed: %s", exc.__class__.__name__)
            raise LlmUnavailable from None
        if response.status_code == 429:
            logger.warning("anthropic call rate limited")
            raise LlmRateLimited
        if response.status_code >= 500:
            logger.warning("anthropic call failed: http=%s", response.status_code)
            raise LlmUnavailable
        if not response.is_success:
            logger.warning("anthropic call rejected: http=%s", response.status_code)
            raise LlmRejected
        return self._parse(response, request)

    # ------------------------------------------------------------------ response
    def _parse(self, response: httpx.Response, request: LlmRequest) -> LlmResponse:
        try:
            data = response.json()
        except ValueError:
            raise LlmBadResponse from None
        if not isinstance(data, dict) or not isinstance(data.get("content"), list):
            raise LlmBadResponse
        usage = data.get("usage")
        if not isinstance(usage, dict):
            raise LlmBadResponse
        tokens_in, tokens_out = (
            _count(usage.get("input_tokens")),
            _count(usage.get("output_tokens")),
        )
        final_name = request.final_result.name if request.final_result else None
        calls: list[ToolCall] = []
        structured: dict[str, Any] | None = None
        for block in data["content"]:
            if not isinstance(block, dict):
                raise LlmBadResponse
            if block.get("type") != "tool_use":
                continue  # plain text from the model is never data
            name, arguments = block.get("name"), block.get("input")
            if not isinstance(name, str) or not isinstance(arguments, dict):
                raise LlmBadResponse
            if name == final_name:
                structured = arguments
            else:
                calls.append(ToolCall(name=name, arguments=arguments))
        micros = (
            tokens_in * self._config.input_micros_per_mtok
            + tokens_out * self._config.output_micros_per_mtok
            + 999_999
        ) // 1_000_000
        return LlmResponse(
            tool_calls=tuple(calls),
            structured=structured,
            usage=Usage(tokens_in, tokens_out, micros),
        )
