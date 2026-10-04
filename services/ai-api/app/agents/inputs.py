"""What a model may be shown about a company: a CONSTANT allowlist of four fields (owner
decision, T006 plan addition b).

No contact field, no free-text note, no raw imported cell, no tag, no industry: they cannot
reach a request because this module is the only way to build the model input and it copies
exactly these fields. The input is also hashed (agent_runs.input_sha256) so the record of a
run says exactly what the model was shown, without storing it."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from dataclasses import asdict, dataclass
from typing import Any
from urllib.parse import urlsplit

ALLOWED_INPUT_FIELDS = ("company_name", "city", "region", "website_host")
NAME_MAX, PLACE_MAX, HOST_MAX = 200, 100, 253


@dataclass(frozen=True)
class ModelInput:
    company_name: str
    city: str | None
    region: str | None
    website_host: str | None


def _text(value: Any, limit: int) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = " ".join(value.split())[:limit]
    return cleaned or None


def _host(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    try:
        parts = urlsplit(value.strip())
        host = parts.hostname if parts.scheme in ("http", "https") else None
    except ValueError:
        return None
    return host[:HOST_MAX].lower() if host else None


def model_input_from_company(row: Mapping[str, Any]) -> ModelInput:
    """Copy the four allowed fields out of a company row. Every other key of the row is ignored,
    whatever it holds."""
    return ModelInput(
        company_name=_text(row.get("name"), NAME_MAX) or "(unnamed)",
        city=_text(row.get("city"), PLACE_MAX),
        region=_text(row.get("region"), PLACE_MAX),
        website_host=_host(row.get("website")),
    )


def input_sha256(model_input: ModelInput) -> str:
    canonical = json.dumps(
        asdict(model_input), sort_keys=True, ensure_ascii=False, separators=(",", ":")
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()
