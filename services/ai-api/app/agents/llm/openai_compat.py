"""Chat-completions adapters behind the LLM port (job AK / K3): OpenAI, and Sarvam (whose chat API has the same wire format); job AN adds three hosted FREE-tier services.

Nothing provider-specific exists outside the `llm` package. The shape is the Anthropic adapter's: our constant policy text in the system message, everything else in the user message
with the untrusted blocks LAST, one request per call (no retries), every provider failure mapped to a constant code, and the key, the URL, the request and the response body never
put into an exception or a log line. Cost is counted exactly as for Anthropic (the owner's prices per million tokens, rounded up), so the same caps apply. Each provider is enabled only
by its own key in the environment (see app.agent_runs.wiring)."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlsplit

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

logger = logging.getLogger("app.agents.llm.openai_compat")

OPENAI_BASE_URL = "https://api.openai.com"
SARVAM_BASE_URL = "https://api.sarvam.ai"
LOCAL_PROVIDER = "local"  # an OpenAI-compatible server on THIS machine (Ollama, LM Studio, llama.cpp): no key, no cost
LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})

# Job AN: hosted free-tier services that speak the same wire format. The ONLY remote addresses the openai_compat adapter accepts, matched EXACTLY (after one trailing slash): a key
# is never sent to any other host, whatever LLM_BASE_URL says. The value is the short name used in log lines.
HOSTED_FREE_PROVIDER = "hosted_free"
HOSTED_FREE_URLS: dict[str, str] = {
    "https://api.groq.com/openai/v1": "groq",
    "https://api.cerebras.ai/v1": "cerebras",
    "https://openrouter.ai/api/v1": "openrouter",
}
HOSTED_FREE_MICROS = 1  # a free tier is recorded at the smallest price the database allows (1 micro per million tokens), so every call still counts for at least a micro and the caps still apply
OPENROUTER_FREE_SUFFIX = (
    ":free"  # OpenRouter bills every other model id; a free-tier id always ends like this
)


def is_local_url(url: str) -> bool:
    """True only for http(s) to this machine. Anything else (another host, a missing scheme, credentials in the URL) is not local."""
    try:
        parts = urlsplit(url)
        host = parts.hostname
        parts.port  # noqa: B018  (raises ValueError for a bad port)
    except ValueError:
        return False
    return parts.scheme in ("http", "https") and parts.username is None and host in LOCAL_HOSTS


def _one_slash_off(url: str) -> str:
    """The address without surrounding spaces and without ONE trailing slash (two slashes are a different address)."""
    root = url.strip()
    return root[:-1] if root.endswith("/") else root


def hosted_free_name(url: str) -> str | None:
    """The short name of an allowed hosted free-tier address ("groq", "cerebras", "openrouter"), or None for anything else. Exact match: no prefix, no other host, no credentials."""
    return HOSTED_FREE_URLS.get(_one_slash_off(url))


def is_hosted_free_url(url: str) -> bool:
    return hosted_free_name(url) is not None


@dataclass(frozen=True)
class ChatCompletionsConfig:
    provider: str  # "openai" | "sarvam" | "local" | "hosted_free": for log lines only
    api_key: str = field(repr=False)
    model: str
    input_micros_per_mtok: int
    output_micros_per_mtok: int
    base_url: str
    path: str = "/v1/chat/completions"
    key_header: str = "Authorization"
    key_prefix: str = "Bearer "
    output_limit_field: str = "max_completion_tokens"
    timeout_seconds: float = 60.0

    def __post_init__(self) -> None:
        if not self.model.strip():
            raise ValueError("a model id is required")
        if self.timeout_seconds <= 0:
            raise ValueError("the timeout must be positive")
        if self.provider == LOCAL_PROVIDER:
            # a model on this machine: no key, and the price may be zero (it costs nothing; the caps still apply)
            if self.input_micros_per_mtok < 0 or self.output_micros_per_mtok < 0:
                raise ValueError("prices cannot be negative")
            if not is_local_url(self.base_url):
                raise ValueError("a local model must be on this machine (localhost or 127.0.0.1)")
            return
        if not self.api_key.strip():
            raise ValueError("an API key and a model id are required")
        if self.provider == HOSTED_FREE_PROVIDER and not is_hosted_free_url(self.base_url):
            raise ValueError("a hosted free model must be on one of the allowed addresses")
        if self.input_micros_per_mtok <= 0 or self.output_micros_per_mtok <= 0:
            raise ValueError(
                "prices must be positive"
            )  # a zero price would make every call look free to the spend cap
        if not self.base_url.startswith("https://"):
            raise ValueError("the base URL must use https")


def openai_config(
    api_key: str, model: str, input_micros: int, output_micros: int, base_url: str = OPENAI_BASE_URL
) -> ChatCompletionsConfig:
    return ChatCompletionsConfig("openai", api_key, model, input_micros, output_micros, base_url)


def sarvam_config(
    api_key: str, model: str, input_micros: int, output_micros: int, base_url: str = SARVAM_BASE_URL
) -> ChatCompletionsConfig:
    """Sarvam's chat completions: the same body as OpenAI's, the key in `api-subscription-key`, the limit in `max_tokens`."""
    return ChatCompletionsConfig(
        "sarvam",
        api_key,
        model,
        input_micros,
        output_micros,
        base_url,
        key_header="api-subscription-key",
        key_prefix="",
        output_limit_field="max_tokens",
    )


def hosted_free_config(api_key: str, model: str, base_url: str) -> ChatCompletionsConfig:
    """A free-tier model on one of the allowed hosted services (HOSTED_FREE_URLS). The key goes in `Authorization: Bearer`, the limit in `max_tokens`, the price is the minimum (1 micro per
    million tokens). The address is the service's own (it already ends in /v1) and nothing else is accepted. OpenRouter is paid for every model id that does not end in `:free`, so any other id is refused."""
    root = _one_slash_off(base_url)
    name = hosted_free_name(root)
    if name is None:
        raise ValueError("a hosted free model must be on one of the allowed addresses")
    if name == "openrouter" and not model.strip().endswith(OPENROUTER_FREE_SUFFIX):
        raise ValueError("an OpenRouter model must be a free one (its id ends in :free)")
    return ChatCompletionsConfig(
        HOSTED_FREE_PROVIDER,
        api_key,
        model,
        HOSTED_FREE_MICROS,
        HOSTED_FREE_MICROS,
        root,
        path="/chat/completions",
        output_limit_field="max_tokens",
    )


def local_config(
    model: str, input_micros: int, output_micros: int, base_url: str
) -> ChatCompletionsConfig:
    """A model served on this machine through an OpenAI-compatible endpoint, e.g. Ollama at http://localhost:11434/v1. No key is sent. The URL may end in /v1 or not."""
    root = base_url.strip().rstrip("/")
    if root.endswith("/v1"):
        root = root[: -len("/v1")]
    return ChatCompletionsConfig(
        LOCAL_PROVIDER,
        "",
        model,
        input_micros,
        output_micros,
        root,
        output_limit_field="max_tokens",
        timeout_seconds=300.0,  # a small model on a laptop CPU can take minutes
    )


def _count(value: Any) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise LlmBadResponse
    return value


def _arguments(value: Any) -> dict[str, Any]:
    """Tool arguments arrive as a JSON string (or, from some servers, already an object). Anything else is a bad response."""
    if isinstance(value, str):
        try:
            value = json.loads(value) if value.strip() else {}
        except ValueError:
            raise LlmBadResponse from None
    if not isinstance(value, dict):
        raise LlmBadResponse
    return value


class ChatCompletionsClient:
    def __init__(
        self, config: ChatCompletionsConfig, *, client: httpx.Client | None = None
    ) -> None:
        self._config = config
        self._client = client or httpx.Client()

    def __repr__(self) -> str:
        return (
            f"ChatCompletionsClient(provider={self._config.provider}, model={self._config.model})"
        )

    @property
    def model_id(self) -> str:
        return self._config.model

    # ------------------------------------------------------------------ request
    def _payload(self, request: LlmRequest) -> dict[str, Any]:
        system = "\n\n".join(b.text for b in request.blocks if b.trust is Trust.SYSTEM)
        trusted = [b.text for b in request.blocks if b.trust is Trust.TRUSTED]
        untrusted = [b.text for b in request.blocks if b.trust is Trust.UNTRUSTED]
        messages: list[dict[str, Any]] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": "\n\n".join((*trusted, *untrusted))})
        tools = [
            {
                "type": "function",
                "function": {
                    "name": t.name,
                    "description": t.description,
                    "parameters": t.input_schema,
                },
            }
            for t in (*request.tools, *([request.final_result] if request.final_result else []))
        ]
        return {
            "model": self._config.model,
            self._config.output_limit_field: request.max_output_tokens,
            "messages": messages,
            "tools": tools,
            "tool_choice": "auto",
        }

    def complete(self, request: LlmRequest) -> LlmResponse:
        provider = self._config.provider
        try:
            headers = {"content-type": "application/json"}
            if self._config.api_key:  # a local server needs no key: none is sent
                headers[self._config.key_header] = (
                    f"{self._config.key_prefix}{self._config.api_key}"
                )
            response = self._client.post(
                f"{self._config.base_url}{self._config.path}",
                headers=headers,
                json=self._payload(request),
                timeout=self._config.timeout_seconds,
            )
        except httpx.TimeoutException:
            logger.warning("%s call timed out", provider)
            raise LlmTimeout from None
        except httpx.HTTPError as exc:
            # the text of a transport error can contain the URL and the headers: the class only
            logger.warning("%s call failed: %s", provider, exc.__class__.__name__)
            raise LlmUnavailable from None
        if response.status_code == 429:
            logger.warning("%s call rate limited", provider)
            raise LlmRateLimited
        if response.status_code >= 500:
            logger.warning("%s call failed: http=%s", provider, response.status_code)
            raise LlmUnavailable
        if not response.is_success:
            logger.warning("%s call rejected: http=%s", provider, response.status_code)
            raise LlmRejected
        return self._parse(response, request)

    # ------------------------------------------------------------------ response
    def _parse(self, response: httpx.Response, request: LlmRequest) -> LlmResponse:
        try:
            data = response.json()
        except ValueError:
            raise LlmBadResponse from None
        if (
            not isinstance(data, dict)
            or not isinstance(data.get("choices"), list)
            or not data["choices"]
        ):
            raise LlmBadResponse
        usage = data.get("usage")
        if not isinstance(usage, dict):
            raise LlmBadResponse
        tokens_in, tokens_out = (
            _count(usage.get("prompt_tokens")),
            _count(usage.get("completion_tokens")),
        )
        choice = data["choices"][0]
        message = choice.get("message") if isinstance(choice, dict) else None
        if not isinstance(message, dict):
            raise LlmBadResponse
        final_name = request.final_result.name if request.final_result else None
        calls: list[ToolCall] = []
        structured: dict[str, Any] | None = None
        raw_calls = message.get("tool_calls")
        if raw_calls is not None and not isinstance(raw_calls, list):
            raise LlmBadResponse
        for item in raw_calls or []:
            function = item.get("function") if isinstance(item, dict) else None
            if not isinstance(function, dict) or not isinstance(function.get("name"), str):
                raise LlmBadResponse
            arguments = _arguments(function.get("arguments"))
            if function["name"] == final_name:
                structured = arguments
            else:
                calls.append(ToolCall(name=function["name"], arguments=arguments))
        # plain text from the model is never data
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
