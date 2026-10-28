"""Job EA: an in-memory assistant database for the conversational turns (what the real functions store, the same refusals). Built on the tasks fake, which already answers the planner's reads."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any

from tests.dr_tasks_fakes import FakeDb

T0 = datetime.now(UTC)


class FakeTurnDb(FakeDb):
    def __init__(self, people: list[dict[str, Any]] | None = None) -> None:
        super().__init__(people)
        self.messages: list[dict[str, Any]] = []
        self.conversations: dict[uuid.UUID, dict[str, Any]] = {}
        self.finished: list[tuple[str, str | None]] = []
        self.marked: list[dict[str, Any]] = []
        self.clock = T0

    def _tick(self) -> datetime:
        self.clock += timedelta(seconds=5)
        return self.clock

    # ---- the run
    def read_run(self) -> Any:
        return SimpleNamespace(status="running", cancel_requested_at=None, expires_at=datetime.now(UTC) + timedelta(days=1))

    def record_step(self, key: str, name: str, sha: str, status: str, out: Any) -> None:
        self.calls.append(("record_step", (name, status)))

    def finish(self, status: str, code: str | None) -> None:
        self.finished.append((status, code))
        super().finish(status, code)

    # ---- the messages
    def begin_message(self, **kw: Any) -> dict[str, Any]:
        self.calls.append(("begin_message", kw))
        conversation = kw["conversation_id"]
        again = next((m for m in self.messages if m["id"] == kw["message_id"]), None)
        if again is not None:
            reply = next((m for m in self.messages if m["conversation_id"] == conversation and m["seq"] == again["seq"] + 1 and m["role"] == "assistant"), None)
            return {"replayed": True, "reply_message_id": reply["id"] if reply else None, "seq": again["seq"]}
        self.conversations.setdefault(conversation, {"created_at": self._tick(), "updated_at": self._tick(), "archived": False})
        seq = 1 + max((m["seq"] for m in self.messages if m["conversation_id"] == conversation), default=0)
        self.messages.append(self._row(kw["message_id"], conversation, seq, "user", kw["text"], kw["language"]))
        return {"replayed": False, "seq": seq, "conversation_id": conversation}

    def _row(self, id_: uuid.UUID, conversation: uuid.UUID, seq: int, role: str, body: str, language: str | None) -> dict[str, Any]:
        return {"id": id_, "conversation_id": conversation, "seq": seq, "role": role, "body": body, "language": language, "sources": [], "drafts": [], "kind": "answer", "task_id": None, "created_at": self._tick().isoformat()}

    def save_reply(self, **kw: Any) -> None:
        self.calls.append(("save_reply", kw))
        planner = kw["text"].startswith(("Plan made", "Question: "))   # the task planner keeps its own bookkeeping conversation ("Plan a task")
        user = next((m for m in reversed(self.messages) if m["role"] == "user" and (m["body"] == "Plan a task") == planner), None)
        conversation = user["conversation_id"] if user else uuid.uuid4()
        seq = 1 + max((m["seq"] for m in self.messages if m["conversation_id"] == conversation), default=0)
        row = self._row(kw["message_id"], conversation, seq, "assistant", kw["text"], kw["language"])
        row["sources"], row["drafts"] = list(kw["sources"]), list(kw["drafts"])
        self.messages.append(row)
        if conversation in self.conversations:
            self.conversations[conversation]["updated_at"] = self._tick()

    def mark_reply(self, *, message_id: uuid.UUID, kind: str, task_id: uuid.UUID | None) -> dict[str, Any]:
        self.marked.append({"message_id": message_id, "kind": kind, "task_id": task_id})
        for m in self.messages:
            if m["id"] == message_id:
                m["kind"], m["task_id"] = kind, str(task_id) if task_id else None
        return {"message_id": message_id, "kind": kind}

    def history(self, conversation_id: uuid.UUID, before_seq: int, limit: int) -> list[dict[str, Any]]:
        rows = [m for m in self.messages if m["conversation_id"] == conversation_id and m["seq"] < before_seq]
        return [{"seq": m["seq"], "role": m["role"], "body": m["body"], "language": m["language"]} for m in rows[-limit:]]

    def conversation(self, conversation_id: uuid.UUID) -> dict[str, Any] | None:
        if conversation_id not in self.conversations:
            return None
        c = self.conversations[conversation_id]
        return {"id": conversation_id, "created_at": c["created_at"], "updated_at": c["updated_at"], "assistant_messages": [m for m in self.messages if m["conversation_id"] == conversation_id]}

    def rest_rows(self, what: str, path: str, params: dict[str, str]) -> list[dict[str, Any]]:
        if path != "/assistant_messages":
            return super().rest_rows(what, path, params)
        rows = [m for m in self.messages if m["id"] is not None]
        if "conversation_id" in params:
            rows = [m for m in rows if str(m["conversation_id"]) == params["conversation_id"][3:]]
        if "role" in params:
            rows = [m for m in rows if m["role"] == params["role"][3:]]
        if params.get("seq", "").startswith("lt."):
            rows = [m for m in rows if m["seq"] < int(params["seq"][3:])]
        if "task_id" in params:
            rows = [m for m in rows if m["task_id"] == params["task_id"][3:]]
        if "kind" in params:
            rows = [m for m in rows if m["kind"] == params["kind"][3:]]
        rows = sorted(rows, key=lambda m: m["seq"], reverse=True)[: int(params.get("limit", "50"))]
        fields = params.get("select", "").split(",")
        return [{f: m[f] for f in fields} for m in rows]

    # ---- the list and archive
    def list_conversations(self, *, tenant_id: uuid.UUID, limit: int, before: str | None) -> dict[str, Any]:
        items = []
        for cid, c in self.conversations.items():
            rows = sorted((m for m in self.messages if m["conversation_id"] == cid), key=lambda m: m["seq"])
            if c["archived"] or not rows or rows[0]["body"] == "Plan a task":
                continue
            items.append({"id": cid, "title": next(m["body"] for m in rows if m["role"] == "user")[:60], "updated_at": c["updated_at"], "message_count": len(rows), "last_text": rows[-1]["body"][:120]})
        items.sort(key=lambda i: i["updated_at"], reverse=True)
        return {"items": items[:limit], "next_before": items[limit - 1]["updated_at"] if len(items) > limit else None}

    def archive_conversation(self, *, tenant_id: uuid.UUID, conversation_id: uuid.UUID) -> dict[str, Any]:
        from app.agents.errors import RunDenied

        if conversation_id not in self.conversations:
            raise RunDenied
        self.conversations[conversation_id]["archived"] = True
        return {"id": conversation_id, "archived": True}


def chat(text: str, *, kind: str = "answer", language: str = "en") -> dict[str, Any]:
    """A scripted model's structured reply for a tool-free chat turn."""
    return {"kind": kind, "answer": text, "language": language}
