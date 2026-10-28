"""One conversational turn (job EA): the router decides the kind, then the right path answers, and the stream ends in exactly one TYPED reply.

  smalltalk, general  -> AssistantRunner.run_chat: one tool-free model call on the light model; no sources; a school never has fees, marks or dues in such a chat
  business            -> AssistantRunner.run: the tool path with sources; an uncited claim about the business is blocked and replaced by "no record" plus one way forward (NO_RECORD_HELP)
  action              -> the task planner (POST /tasks/plan, or POST /tasks/{id}/answer when the last reply asked a question): a plan (`confirm_action`) or ONE question (`clarify`)
Nothing an action names runs here: the plan waits for the owner's yes (POST /assistant/actions/{id}/confirm). The storage, cost reservation, replay and failure sentences are the written Ask's own."""

from __future__ import annotations

import logging
import queue
import re
import threading
import uuid
from collections.abc import Callable, Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

from app.agent_runs import pause
from app.agents.errors import AgentDbError, CostCapReached
from app.assistant import resolver
from app.assistant.db import AssistantDb
from app.assistant.language import SCHOOL_REFUSAL, Language, detect_language
from app.assistant.notes import owner_notes
from app.assistant.routes import FAILURES, _factory, _refusal, _sse
from app.assistant.runner import AssistantRunner, Outcome, Reply, _sha
from app.assistant.tools import Ctx, State
from app.auth.deps import Runtime, TenantContext, _second_factor_on
from app.errors import ApiError
from app.tasks.models import AnswerIn, PlanIn, TaskOut
from app.tenancy.models import Role
from app.turns import words
from app.turns.intent import Intent, Kind, classify
from app.turns.models import ConfirmOut, TaskRef, TurnIn
from app.turns.status import PLAN_MINUTES, action_status

logger = logging.getLogger("app.turns.service")

TURN_HISTORY = 8      # the turns the model sees in a chat (the panel shows them all)
BUSINESS_HISTORY = 4  # the tool path keeps its own, smaller window (job AO)
SHORT_MESSAGE_WORDS = 3
# a school's chat with a model never has fees, marks, results or dues in it (the child-data rule); the planner and the figure tool have their own guards
_SCHOOL_TOPIC = re.compile(
    r"\b(fees?|marks?|results?|rank|dues?|outstanding|scholarship|report card|grades?)\b|ఫీజు|మార్కు|ఫలిత|బకాయి|फीस|अंक|नतीजे|परिणाम|बकाया|ಶುಲ್ಕ|ಅಂಕ|ಫಲಿತಾಂಶ|ಬಾಕಿ",
    re.IGNORECASE,
)


def language_of(body: TurnIn) -> Language:
    """The language of the message by its script; the screen's language only decides a very short message that has none of its own."""
    found = detect_language(body.text)
    if body.language_hint and found == "en" and len(body.text.split()) <= SHORT_MESSAGE_WORDS:
        return body.language_hint
    return found


def confirm_payload(task: TaskOut, language: Language, *, needs_second_factor: bool, can_confirm: bool, proposed_at: datetime) -> dict[str, Any]:
    """The card of a proposed action: what the plan is, who, how, when, what it costs, and the one tap. Built from the stored task (so a replay shows its state now)."""
    plan = task.plan
    assert plan is not None   # noqa: S101  (a planned task has a plan; the caller checks)
    people = words.PEOPLE[language].replace("{n}", str(plan.contacts_total))
    how = words.HOW[language][plan.channel]
    day = words.DAY[language].get(plan.window.date, plan.window.date)
    when = f"{day}, {plan.window.from_minute // 60:02d}:{plan.window.from_minute % 60:02d}-{plan.window.to_minute // 60:02d}:{plan.window.to_minute % 60:02d}"
    estimate = task.estimate
    return {
        "action_id": str(task.id),
        "status": "proposed",
        "title": plan.goal[:120],
        "summary": words.PLAN_SENTENCE[language].replace("{goal}", plan.goal).replace("{people}", people).replace("{how}", how),
        "steps": [words.STEP_WHO[language].replace("{people}", people), words.STEP_HOW[language].replace("{how}", how), words.STEP_WHEN[language].replace("{when}", when), *plan.notes[:3]],
        "count": plan.contacts_total,
        "channel": plan.channel,
        "estimate": {"messages": estimate.messages, "call_minutes": estimate.minutes, "cost_paise": estimate.cost_paise} if estimate is not None else None,
        "needs_second_factor": needs_second_factor,
        "can_confirm": can_confirm,
        "expires_at": (proposed_at + timedelta(minutes=PLAN_MINUTES)).astimezone(UTC).isoformat().replace("+00:00", "Z"),
    }


def _needs_second_factor(runtime: Runtime, ctx: TenantContext) -> bool:
    return ctx.role in (Role.OWNER, Role.ADMIN) and ctx.principal.aal != "aal2" and _second_factor_on(runtime, ctx.principal)


def _typed(reply: Reply | None) -> str:
    if reply is None:
        return "answer"
    return reply.kind if reply.kind in ("confirm_action", "clarify") else "answer"


def _last_reply(db: AssistantDb, conversation_id: uuid.UUID, before_seq: int) -> dict[str, Any] | None:
    """The assistant's last reply before this message: its type, the task behind it and whether it cited records (to carry a short follow-up on and to continue a question)."""
    try:
        rows = db.rest_rows(
            "read_last_reply",
            "/assistant_messages",
            {"select": "kind,task_id,sources", "conversation_id": f"eq.{conversation_id}", "role": "eq.assistant", "seq": f"lt.{before_seq}", "order": "seq.desc", "limit": "1"},
        )
    except AgentDbError:
        return None
    return rows[0] if rows else None


def _previous_kind(last: dict[str, Any] | None) -> Kind | None:
    if last is None:
        return None
    if last.get("task_id"):
        return "action"
    return "business" if last.get("sources") else "general"


def _pending_question(runtime: Runtime, ctx: TenantContext, last: dict[str, Any] | None) -> TaskOut | None:
    """The task the last reply asked a question about, while it still waits for the answer: the new message IS the answer."""
    if last is None or last.get("kind") != "clarify" or not last.get("task_id") or runtime.tasks is None:
        return None
    try:
        task = runtime.tasks.get(ctx.principal.token, ctx.tenant.id, uuid.UUID(str(last["task_id"])))
    except Exception:
        return None
    return task if task.status == "needs_answer" else None


def start_turn(
    runtime: Runtime,
    ctx: TenantContext,
    body: TurnIn,
    *,
    charge: Callable[[AssistantDb], None] | None = None,
    on_reply: Callable[[AssistantDb, str, str], None] | None = None,
) -> Iterator[str]:
    """Begin one turn and return its stream of server-sent events. Everything that can refuse does so HERE, before any byte is streamed (the same refusals as the written Ask).
    Events: intent, step, text, source, draft, confirm_action | clarify, done (with the typed `kind`) or error."""
    agents = _factory(runtime)
    token, tenant = ctx.principal.token, ctx.tenant.id
    conversation_id = body.conversation_id or uuid.uuid4()
    run_id = uuid.uuid4()
    language = language_of(body)
    db: AssistantDb = agents.assistant_db(token, run_id)
    try:
        began = db.begin_message(
            tenant_id=tenant,
            conversation_id=conversation_id,
            message_id=body.message_id,
            text=body.text,
            language=language,
            input_sha256=_sha({"conversation": str(conversation_id), "message": str(body.message_id), "text": body.text}),
        )
    except AgentDbError as exc:
        db.close()
        raise _refusal(exc, runtime.today, token, tenant) from None

    if began.get("replayed"):
        return _replay(runtime, ctx, agents, db, conversation_id, began, language)

    if charge is not None:
        try:
            charge(db)
        except AgentDbError as exc:
            try:
                db.finish("failed", "budget" if isinstance(exc, CostCapReached) else "tool_failed")
            except AgentDbError:
                pass
            finally:
                db.close()
            raise _refusal(exc, runtime.today, token, tenant) from None

    seq = int(began.get("seq") or 1)
    history = db.history(conversation_id, seq, TURN_HISTORY)
    last = _last_reply(db, conversation_id, seq)
    state = State()
    runner = AssistantRunner(
        db=db,
        llm=agents.llm_for("ask")(),
        ctx=Ctx(db, runtime, token, tenant, run_id, state),
        on_reply=(lambda text, lang: on_reply(db, text, lang)) if on_reply is not None else None,
        help_on_empty=True,
        typed_replies=True,
        owner_notes=owner_notes(runtime, token, tenant),
    )
    events: queue.Queue[tuple[str, dict[str, Any]] | None] = queue.Queue()
    reply_id = uuid.uuid4()
    outcome_box: list[Outcome] = []

    def emit(name: str, data: dict[str, Any]) -> None:
        events.put((name, data))

    def work() -> None:
        try:
            outcome_box.append(_dispatch(runtime, ctx, body, language, history, last, runner, emit, reply_id))
        except Exception as exc:   # last resort: only the class is kept; the stream ends with a fixed error
            logger.error("assistant turn %s crashed: %s", run_id, exc.__class__.__name__)
            outcome_box.append(Outcome("failed", "tool_failed"))
        finally:
            events.put(None)
            db.close()

    threading.Thread(target=work, daemon=True).start()

    def stream() -> Iterator[str]:
        while True:
            item = events.get()
            if item is None:
                break
            yield _sse(item[0], item[1])
        outcome = outcome_box[0] if outcome_box else Outcome("failed", "tool_failed")
        if outcome.reply is None:
            code, message = FAILURES.get(outcome.shown or outcome.error_code or "tool_failed", FAILURES["tool_failed"])
            event: dict[str, Any] = {"type": "error", "code": code, "message": message}
            if code == pause.CODE:
                event["until"] = pause.resolve_until(runtime.today, token, tenant).astimezone(UTC).isoformat().replace("+00:00", "Z")
            yield _sse("error", event)
        else:
            yield _sse("done", {"type": "done", "message_id": str(reply_id), "conversation_id": str(conversation_id), "language": outcome.reply.language, "kind": _typed(outcome.reply)})

    return stream()


def _dispatch(
    runtime: Runtime,
    ctx: TenantContext,
    body: TurnIn,
    language: Language,
    history: list[dict[str, Any]],
    last: dict[str, Any] | None,
    runner: AssistantRunner,
    emit: Callable[[str, dict[str, Any]], None],
    reply_id: uuid.UUID,
) -> Outcome:
    """Decide the kind, tell the client first, then run the path."""
    pending = _pending_question(runtime, ctx, last)
    intent = Intent("action", "answers_question") if pending is not None else classify(body.text, _previous_kind(last))
    emit("intent", {"type": "intent", "kind": intent.kind})
    logger.info("assistant turn: kind=%s reason=%s language=%s", intent.kind, intent.reason, language)
    if intent.kind in ("smalltalk", "general"):
        if runtime.tasks is not None and _SCHOOL_TOPIC.search(body.text) and runtime.tasks.is_school(runtime, ctx.principal.token, ctx.tenant.id):
            return runner.finish_with(Reply(SCHOOL_REFUSAL[language], language, "answer"), reply_id, emit)
        name = _assistant_name(runtime, ctx)
        return runner.run_chat(
            question=body.text, language=language, history=history, emit=emit, message_id=reply_id,
            assistant_name=name, business_name=ctx.tenant.name, small=intent.kind == "smalltalk", owner_notes=runner.owner_notes,
        )
    if intent.kind == "business":
        return runner.run(question=body.text, language=language, history=history[-BUSINESS_HISTORY:], emit=emit, message_id=reply_id)
    return _run_action(runtime, ctx, body, language, pending, runner, emit, reply_id)


def _assistant_name(runtime: Runtime, ctx: TenantContext) -> str:
    """The name the owner chose, else the plain phrase 'your assistant' (no fixed name)."""
    try:
        return runtime.repository.get_assistant_name(ctx.principal.token, ctx.tenant.id) or "your assistant"
    except Exception:
        return "your assistant"


def _run_action(
    runtime: Runtime,
    ctx: TenantContext,
    body: TurnIn,
    language: Language,
    pending: TaskOut | None,
    runner: AssistantRunner,
    emit: Callable[[str, dict[str, Any]], None],
    reply_id: uuid.UUID,
) -> Outcome:
    # the planner turns a database refusal into the same ApiError the tasks routes raise
    from app.tasks.routes import _refusal as task_refusal

    tasks = runtime.tasks
    if tasks is None:
        return runner.finish_with(Reply(words.CANNOT_PLAN[language], language, "clarify"), reply_id, emit)
    token, tenant = ctx.principal.token, ctx.tenant.id
    emit("step", {"type": "step", "step": "working"})
    try:
        if pending is not None:
            task = tasks.answer(runtime, token, tenant, ctx.tenant.name, pending.id, AnswerIn(answer=body.text), task_refusal(runtime, ctx))
        else:
            task = tasks.plan(runtime, token, tenant, ctx.tenant.name, PlanIn(instruction=body.text, language=language), task_refusal(runtime, ctx))
    except ApiError as exc:
        if exc.code == pause.CODE:
            return runner.fail_with("budget")
        logger.warning("assistant action could not be planned: %s", exc.code)
        return runner.finish_with(Reply(words.CANNOT_PLAN[language], language, "clarify"), reply_id, emit)
    except Exception as exc:
        logger.warning("assistant action could not be planned: %s", exc.__class__.__name__)
        return runner.finish_with(Reply(words.CANNOT_PLAN[language], language, "clarify"), reply_id, emit)
    if task.question:
        return runner.finish_with(Reply(task.question, language, "clarify", task_id=task.id), reply_id, emit, extra=(("clarify", {"question": task.question, "action_id": str(task.id)}),))
    if task.status == "planned" and task.plan is not None:
        payload = confirm_payload(task, language, needs_second_factor=_needs_second_factor(runtime, ctx), can_confirm=ctx.role == Role.OWNER, proposed_at=datetime.now(UTC))
        return runner.finish_with(Reply(str(payload["summary"]), language, "confirm_action", task_id=task.id), reply_id, emit, extra=(("confirm_action", payload),))
    return runner.finish_with(Reply(words.CANNOT_PLAN[language], language, "clarify"), reply_id, emit)


def _replay(
    runtime: Runtime, ctx: TenantContext, agents: Any, db: AssistantDb, conversation_id: uuid.UUID, began: dict[str, Any], language: Language
) -> Iterator[str]:
    """The same message again: the stored reply, with its sources, drafts and (for a plan or a question) the card as it stands now. Nothing is spent."""
    try:
        stored = db.conversation(conversation_id)
    finally:
        db.close()
    messages = (stored or {}).get("assistant_messages") or []
    reply = next((m for m in messages if str(m["id"]) == str(began.get("reply_message_id"))), None)
    if reply is None:
        raise ApiError(409, "message_unanswered", "That message was not answered. Send it again as a new message.")
    db2: AssistantDb = agents.assistant_db(ctx.principal.token, uuid.uuid4())
    try:
        sources, drafts = resolver.resolve(db2, reply["sources"], reply["drafts"])
    finally:
        db2.close()
    kind = reply.get("kind") or "answer"
    shown: Language = reply.get("language") or language

    def replay() -> Iterator[str]:
        yield _sse("text", {"type": "text", "delta": reply["body"]})
        for source in sources:
            yield _sse("source", {"type": "source", **source.model_dump(mode="json")})
        for draft in drafts:
            yield _sse("draft", {"type": "draft", **draft.model_dump(mode="json")})
        task_id = reply.get("task_id")
        if kind == "clarify" and task_id:
            yield _sse("clarify", {"type": "clarify", "question": reply["body"], "action_id": str(task_id)})
        elif kind == "confirm_action" and task_id and runtime.tasks is not None:
            try:
                task = runtime.tasks.get(ctx.principal.token, ctx.tenant.id, uuid.UUID(str(task_id)))
                proposed_at = datetime.fromisoformat(str(reply["created_at"]).replace("Z", "+00:00"))
                if task.plan is not None:
                    payload = confirm_payload(task, shown, needs_second_factor=_needs_second_factor(runtime, ctx), can_confirm=ctx.role == Role.OWNER, proposed_at=proposed_at)
                    payload["status"] = action_status(task.status, proposed_at, datetime.now(UTC))
                    yield _sse("confirm_action", {"type": "confirm_action", **payload})
            except Exception:
                logger.warning("assistant replay: the plan card could not be rebuilt")
        yield _sse("done", {"type": "done", "message_id": str(reply["id"]), "conversation_id": str(conversation_id), "language": reply.get("language"), "kind": kind})

    return replay()


def _proposed_at(runtime: Runtime, ctx: TenantContext, agents: Any, action_id: uuid.UUID) -> datetime:
    """When the caller's own reply proposed this action (a person reads only their own chats, so someone else's plan is the same 404 as an unknown one)."""
    from app.assistant.routes import _refusal as assistant_refusal
    from app.errors import not_found

    db: AssistantDb = agents.assistant_db(ctx.principal.token, uuid.uuid4())
    try:
        rows = db.rest_rows(
            "read_proposal",
            "/assistant_messages",
            {"select": "created_at", "tenant_id": f"eq.{ctx.tenant.id}", "task_id": f"eq.{action_id}", "kind": "eq.confirm_action", "order": "seq.desc", "limit": "1"},
        )
    except AgentDbError as exc:
        raise assistant_refusal(exc) from None
    finally:
        db.close()
    if not rows:
        raise not_found()
    return datetime.fromisoformat(str(rows[0]["created_at"]).replace("Z", "+00:00"))


def confirm_decision(runtime: Runtime, ctx: TenantContext, task_id: uuid.UUID, decision: str, schedule: Callable[..., Any]) -> ConfirmOut:
    """The owner's yes or no to a plan (the HTTP route and the voice socket both come here). `yes` approves the planned task exactly as POST /tasks/{id}/approve does and `schedule`s its run; `no` cancels it.
    Asking again with the same answer gives the same answer. Raises ApiError: 404 (not the caller's plan), 409 `action_expired` / `action_state`, 403 `mfa_required`."""
    from app.errors import mfa_required

    tasks = runtime.tasks
    if tasks is None:
        raise ApiError(503, "tasks_unavailable", "Tasks are not available right now.")
    agents = _factory(runtime)
    token, tenant = ctx.principal.token, ctx.tenant.id
    proposed_at = _proposed_at(runtime, ctx, agents, task_id)
    task = tasks.get(token, tenant, task_id)
    state = action_status(task.status, proposed_at, datetime.now(UTC))
    if decision == "no":
        if state in ("proposed", "expired"):
            task = tasks.set_state(token, tenant, task_id, "cancel")
        elif state != "declined":
            raise ApiError(409, "action_state", "That plan was already answered.")
        return ConfirmOut(action_id=task_id, status="declined", task=TaskRef(id=task.id, status=task.status))
    if state == "expired":
        raise ApiError(409, "action_expired", "That plan waited too long. Ask again and I will make a fresh one.")
    if state == "declined":
        raise ApiError(409, "action_state", "That plan was cancelled.")
    if state == "proposed":
        if task.status != "planned" or not task.plan_sha256:
            raise ApiError(409, "action_state", "That plan is not ready for a yes yet.")
        if _needs_second_factor(runtime, ctx):
            raise mfa_required("second_factor")
        task = tasks.approve(token, tenant, task_id, task.plan_sha256, None)
        schedule(tasks.run, runtime, token, tenant, ctx.tenant.name, task.id)
        state = "confirmed"
    return ConfirmOut(action_id=task_id, status=state, task=TaskRef(id=task.id, status=task.status))  # type: ignore[arg-type]
