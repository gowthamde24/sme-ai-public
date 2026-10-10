"""The Google Gemini adapter behind the LLM port (job AK / K3): `generateContent` over httpx.

Same rules as the other adapters: our constant policy text is the system instruction, everything else is the user turn with the untrusted blocks LAST, one request per call, constant
error codes, and the key (sent in a header, never in the URL), the request and the response never put into an exception or a log line. The tool schemas are reduced to the OpenAPI
subset Gemini accepts (see `to_gemini_schema`). Cost: the owner's prices per million tokens, rounded up; "thinking" tokens are billed as output, so they are counted as output."""

from __future__ import annotations

import logging
import re
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

logger = logging.getLogger("app.agents.llm.gemini")

DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com"
_MODEL = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,99}")


@dataclass(frozen=True)
class GeminiConfig:
    api_key: str = field(repr=False)
    model: str
    input_micros_per_mtok: int
    output_micros_per_mtok: int
    base_url: str = DEFAULT_BASE_URL
    timeout_seconds: float = 60.0

    def __post_init__(self) -> None:
        if not self.api_key.strip() or not self.model.strip():
            raise ValueError("an API key and a model id are required")
        if not _MODEL.fullmatch(self.model.strip()):
            raise ValueError(
                "the model id has characters a model id does not have"
            )  # it goes into the URL path
        if self.input_micros_per_mtok <= 0 or self.output_micros_per_mtok <= 0:
            raise ValueError("prices must be positive")
        if self.timeout_seconds <= 0:
            raise ValueError("the timeout must be positive")
        if not self.base_url.startswith("https://"):
            raise ValueError("the base URL must use https")


_DROP = {
    "additionalProperties",
    "title",
    "default",
    "$schema",
    "$defs",
    "definitions",
    "examples",
    "const",
}


def to_gemini_schema(schema: Any, defs: dict[str, Any] | None = None) -> Any:
    """JSON Schema (pydantic's) reduced to the OpenAPI subset Gemini accepts: `$ref` inlined, `anyOf [X, null]` becomes X with `nullable`, `const` becomes a one-value `enum`,
    and the keywords it rejects (additionalProperties, title, default...) are dropped. Our own code still validates every argument against the CLOSED schema; this only shapes the offer."""
    if defs is None and isinstance(schema, dict):
        defs = {**schema.get("$defs", {}), **schema.get("definitions", {})}
    if isinstance(schema, list):
        return [to_gemini_schema(s, defs) for s in schema]
    if not isinstance(schema, dict):
        return schema
    ref = schema.get("$ref")
    if isinstance(ref, str) and defs is not None and ref.rsplit("/", 1)[-1] in defs:
        return to_gemini_schema(defs[ref.rsplit("/", 1)[-1]], defs)
    options = schema.get("anyOf") or schema.get("oneOf")
    if isinstance(options, list):
        real = [o for o in options if not (isinstance(o, dict) and o.get("type") == "null")]
        if len(real) == 1:
            merged = to_gemini_schema(real[0], defs)
            if isinstance(merged, dict) and len(real) != len(options):
                merged = {**merged, "nullable": True}
            return merged
    out: dict[str, Any] = {}
    for key, value in schema.items():
        if key in _DROP or key in ("anyOf", "oneOf", "$ref"):
            continue
        out[key] = (
            to_gemini_schema(value, defs)
            if key in ("properties", "items") or isinstance(value, (dict, list))
            else value
        )
    if "const" in schema:
        out["enum"] = [schema["const"]]
    return out


def _count(value: Any, *, optional: bool = False) -> int:
    if value is None and optional:
        return 0
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise LlmBadResponse
    return value


class GeminiClient:
    def __init__(self, config: GeminiConfig, *, client: httpx.Client | None = None) -> None:
        self._config = config
        self._client = client or httpx.Client()

    def __repr__(self) -> str:
        return f"GeminiClient(model={self._config.model})"

    @property
    def model_id(self) -> str:
        return self._config.model

    def _payload(self, request: LlmRequest) -> dict[str, Any]:
        system = "\n\n".join(b.text for b in request.blocks if b.trust is Trust.SYSTEM)
        trusted = [b.text for b in request.blocks if b.trust is Trust.TRUSTED]
        untrusted = [b.text for b in request.blocks if b.trust is Trust.UNTRUSTED]
        declarations = [
            {
                "name": t.name,
                "description": t.description,
                "parameters": to_gemini_schema(t.input_schema),
            }
            for t in (*request.tools, *([request.final_result] if request.final_result else []))
        ]
        payload: dict[str, Any] = {
            "contents": [
                {"role": "user", "parts": [{"text": text} for text in (*trusted, *untrusted)]}
            ],
            "tools": [{"functionDeclarations": declarations}],
            "toolConfig": {"functionCallingConfig": {"mode": "AUTO"}},
            "generationConfig": {"maxOutputTokens": request.max_output_tokens},
        }
        if system:
            payload["systemInstruction"] = {"parts": [{"text": system}]}
        return payload

    def complete(self, request: LlmRequest) -> LlmResponse:
        try:
            response = self._client.post(
                f"{self._config.base_url}/v1beta/models/{self._config.model.strip()}:generateContent",
                headers={
                    "x-goog-api-key": self._config.api_key,
                    "content-type": "application/json",
                },
                json=self._payload(request),
                timeout=self._config.timeout_seconds,
            )
        except httpx.TimeoutException:
            logger.warning("gemini call timed out")
            raise LlmTimeout from None
        except httpx.HTTPError as exc:
            logger.warning("gemini call failed: %s", exc.__class__.__name__)
            raise LlmUnavailable from None
        if response.status_code == 429:
            logger.warning("gemini call rate limited")
            raise LlmRateLimited
        if response.status_code >= 500:
            logger.warning("gemini call failed: http=%s", response.status_code)
            raise LlmUnavailable
        if not response.is_success:
            logger.warning("gemini call rejected: http=%s", response.status_code)
            raise LlmRejected
        return self._parse(response, request)

    def _parse(self, response: httpx.Response, request: LlmRequest) -> LlmResponse:
        try:
            data = response.json()
        except ValueError:
            raise LlmBadResponse from None
        if not isinstance(data, dict):
            raise LlmBadResponse
        usage = data.get("usageMetadata")
        if not isinstance(usage, dict):
            raise LlmBadResponse
        tokens_in = _count(usage.get("promptTokenCount"))
        tokens_out = _count(usage.get("candidatesTokenCount"), optional=True) + _count(
            usage.get("thoughtsTokenCount"), optional=True
        )
        candidates = data.get("candidates")
        if candidates is not None and not isinstance(candidates, list):
            raise LlmBadResponse
        final_name = request.final_result.name if request.final_result else None
        calls: list[ToolCall] = []
        structured: dict[str, Any] | None = None
        content = (
            candidates[0].get("content") if candidates and isinstance(candidates[0], dict) else None
        )
        parts = (
            content.get("parts") if isinstance(content, dict) else None
        )  # a blocked answer has no content: no calls, no result
        for part in parts or []:
            if not isinstance(part, dict):
                raise LlmBadResponse
            call = part.get("functionCall")
            if call is None:
                continue  # text and thoughts are never data
            if not isinstance(call, dict) or not isinstance(call.get("name"), str):
                raise LlmBadResponse
            args = call.get("args", {})
            if not isinstance(args, dict):
                raise LlmBadResponse
            if call["name"] == final_name:
                structured = args
            else:
                calls.append(ToolCall(name=call["name"], arguments=args))
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
