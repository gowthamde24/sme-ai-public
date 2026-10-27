"""What the knowledge routes call (job DR / A1): read an uploaded file or a pasted text into a source, draft facts from it with the model, and let the Owner decide. Also the one question a prompt asks: the approved facts."""

from __future__ import annotations

import base64
import binascii
import json
import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any

from app.knowledge import extract
from app.knowledge.models import (
    MAX_FILE_BYTES,
    FactEditIn,
    FactIn,
    FactOut,
    FactsOut,
    SourceIn,
    SourceOut,
    SourcesOut,
)
from app.knowledge.readers import DocumentReader, NoText, Unreadable, clean, read_document
from app.knowledge.repository import KnowledgeRepository

if TYPE_CHECKING:
    from app.auth.deps import Runtime


def encode_cursor(created_at: str, fact_id: str) -> str:
    return base64.urlsafe_b64encode(json.dumps([created_at, fact_id]).encode()).decode().rstrip("=")


def decode_cursor(raw: str) -> tuple[datetime, uuid.UUID] | None:
    try:
        at, fid = json.loads(base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)))
        return datetime.fromisoformat(at), uuid.UUID(fid)
    except (ValueError, TypeError, binascii.Error):
        return None


class KnowledgeService:
    def __init__(self, repository: KnowledgeRepository, ocr: DocumentReader | None = None) -> None:
        self._repo, self._ocr = repository, ocr

    def add_source(self, token: str, tenant_id: uuid.UUID, body: SourceIn) -> SourceOut:
        if body.kind == "paste":
            text = clean(body.text or "")
            filename = content_type = None
        else:
            try:
                data = base64.b64decode(body.content_base64 or "", validate=True)
            except (binascii.Error, ValueError):
                raise Unreadable from None
            text = read_document(data[: MAX_FILE_BYTES + 1], self._ocr)
            filename, content_type = body.filename, body.content_type or "application/octet-stream"
        if not text:
            raise NoText
        raw = self._repo.source_add(token, tenant_id, {"p_id": str(body.source_id), "p_kind": body.kind, "p_title": body.title, "p_filename": filename, "p_content_type": content_type, "p_text": text})
        return SourceOut.model_validate(raw)

    def sources(self, token: str, tenant_id: uuid.UUID) -> SourcesOut:
        return SourcesOut(sources=[SourceOut.model_validate(r) for r in self._repo.sources(token, tenant_id)])

    def discard(self, token: str, tenant_id: uuid.UUID, source_id: uuid.UUID) -> SourceOut:
        return SourceOut.model_validate(self._repo.source_discard(token, tenant_id, source_id))

    def draft_facts(self, runtime: Runtime, token: str, tenant_id: uuid.UUID, source_id: uuid.UUID, refusal: Any) -> list[FactOut]:
        source = self._repo.source_text(token, tenant_id, source_id)
        drafted = extract.draft_facts(runtime, token, tenant_id, str(source["title"]), str(source["text"]), refusal)
        rows = self._repo.facts_replace(token, tenant_id, source_id, [{"id": str(uuid.uuid4()), **f} for f in drafted])
        return [FactOut.model_validate(r) for r in rows]

    def facts(self, token: str, tenant_id: uuid.UUID, status: str | None, source_id: uuid.UUID | None, limit: int, after: tuple[datetime, uuid.UUID] | None) -> FactsOut:
        rows = self._repo.facts(token, tenant_id, status, source_id, limit, after)
        facts = [FactOut.model_validate(r) for r in rows]
        cursor = encode_cursor(rows[-1]["created_at"], rows[-1]["id"]) if len(rows) >= limit else None
        return FactsOut(facts=facts, next_cursor=cursor)

    def add_fact(self, token: str, tenant_id: uuid.UUID, body: FactIn) -> FactOut:
        return FactOut.model_validate(self._repo.fact_add(token, tenant_id, body.fact_id, body.kind, body.text))

    def edit_fact(self, token: str, tenant_id: uuid.UUID, fact_id: uuid.UUID, body: FactEditIn) -> FactOut:
        return FactOut.model_validate(self._repo.fact_edit(token, tenant_id, fact_id, body.text, body.kind))

    def decide(self, token: str, tenant_id: uuid.UUID, fact_id: uuid.UUID, decision: str) -> FactOut:
        return FactOut.model_validate(self._repo.fact_decide(token, tenant_id, fact_id, decision))

    def approved(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        """The facts the assistant may state: kind and text only."""
        return [{"kind": str(r["kind"]), "text": str(r["text"])} for r in self._repo.approved(token, tenant_id)]
