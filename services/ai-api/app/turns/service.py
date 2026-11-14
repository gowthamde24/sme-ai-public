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
from app.assistant.language import SCHOOL_REFUSAL, Language, detect_owner_language, reply_matches
from app.assistant.notes import address_as, owner_notes
from app.assistant.routes import FAILURES, SORRY_CODES, _factory, _refusal, _sse, sorry_stream
from app.assistant.runner import AssistantRunner, Outcome, Reply, _sha
from app.assistant.tools import Ctx, State
from app.assistant.voice import region_for
from app.auth.deps import Runtime, TenantContext, _second_factor_on
from app.errors import ApiError
from app.tasks.models import AnswerIn, PlanIn, TaskOut
from app.tenancy.models import Role
from app.turns import lead_finder as lf_turn
from app.turns import words
from app.turns.intent import Intent, Kind, classify
from app.turns.models import AskConsentIn, AskConsentOut, ConfirmOut, TaskRef, TurnIn
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
    """The language the person CHOSE on the assistant bar, if they did (the reply is in it whatever the words inside are, so Telugu with English words stays Telugu); otherwise the language of the message by its
    script, where the screen's language only decides a very short message that has none of its own."""
    if body.language is not None and body.language != "auto":
        return body.language
    found = detect_owner_language(body.text)
    if body.language_hint and found == "en" and len(body.text.split()) <= SHORT_MESSAGE_WORDS:
        return body.language_hint
    return found


def _spoken(table: dict[Any, Any], language: Language) -> Any:
    """A word table for the conversation's language; a language without one (Tamil, Malayalam, Marathi for the newer sentences) gets the English one."""
    return table.get(language) or table["en"]


def shown_goal(task: TaskOut, language: Language) -> str:
    """What the plan does, in the conversation's language. The model's own goal sentence is used only when it IS in that language; otherwise (an English goal in a Telugu talk) the fixed, spoken sentence of the template."""
    plan = task.plan
    assert plan is not None   # noqa: S101
    if language == "en" or reply_matches(plan.goal, language):
        return plan.goal
    table = words.GOAL.get(language)
    if table is None:
        return ""
    return table.get(task.template) or table["custom"]


def second_confirm_words(language: Language, channel: str, count: int) -> str:
    """The plainer second question of a big plan ("నిజంగా 255 మందికి కాల్ చెయ్యనా?")."""
    people = words.PEOPLE[language].replace("{n}", str(count))
    return str(_spoken(words.SECOND_CONFIRM, language).get(channel, "")).replace("{people}", people)


def confirm_payload(task: TaskOut, language: Language, *, needs_second_factor: bool, can_confirm: bool, proposed_at: datetime, skipped_sample: list[dict[str, Any]] | None = None, daily_cap: dict[str, Any] | None = None) -> dict[str, Any]:
    """The card of a proposed action: what the plan is, who, how, when, what it costs, and the one tap. Built from the stored task (so a replay shows its state now).
    Every word the card says is in `language`, spoken style: the goal, the question, the steps and the notes."""
    plan = task.plan
    assert plan is not None   # noqa: S101  (a planned task has a plan; the caller checks)
    people = words.PEOPLE[language].replace("{n}", str(plan.contacts_total))
    how = words.HOW[language][plan.channel]
    day = words.DAY[language].get(plan.window.date, plan.window.date)
    when = f"{day}, {plan.window.from_minute // 60:02d}:{plan.window.from_minute % 60:02d}-{plan.window.to_minute // 60:02d}:{plan.window.to_minute % 60:02d}"
    estimate = task.estimate
    sentence = (words.PLAN_ASK.get(language) or {}).get(plan.channel) or words.PLAN_SENTENCE[language]
    goal = shown_goal(task, language)
    summary = " ".join(sentence.replace("{goal}", goal).replace("{people}", people).replace("{how}", how).split())
    notes = [(words.NOTE.get(language) or {}).get(code) or text for code, text in zip(plan.note_codes, plan.notes, strict=False)] if plan.note_codes else list(plan.notes)
    audience = None
    if plan.audience is not None:
        audience = {"kind": plan.audience.kind, "label": _spoken(words.AUDIENCE, language).get(plan.audience.kind, ""), "count": plan.audience.count}
    consent = None
    if plan.consent is not None:
        consent = {"callable": plan.consent.callable, "skipped": plan.consent.skipped, "skipped_sample": (skipped_sample or [])[:10], "reason_counts": plan.consent.reason_counts}
    return {
        "action_id": str(task.id),
        "status": "proposed",
        "language": language,
        "title": words.TITLE[language].get(plan.channel, words.TITLE[language]["call"]).replace("{people}", people),
        "summary": summary,
        "steps": [words.STEP_WHO[language].replace("{people}", people), words.STEP_HOW[language].replace("{how}", how), words.STEP_WHEN[language].replace("{when}", when), *notes[:3]],
        "when": {"date": plan.window.date, "from_minute": plan.window.from_minute, "to_minute": plan.window.to_minute},
        "count": plan.contacts_total,
        "channel": plan.channel,
        "estimate": {"messages": estimate.messages, "call_minutes": estimate.minutes, "cost_paise": estimate.cost_paise} if estimate is not None else None,
        "audience": audience,
        "consent": consent,
        "needs_second_confirm": plan.needs_second_confirm,
        "second_confirm_text": second_confirm_words(language, plan.channel, plan.contacts_total) if plan.needs_second_confirm else None,
        "daily_cap": daily_cap,   # {limit, used, remaining}: the business's own per-day call limit (default 100) for a plan that calls; null for WhatsApp-only plans (the outbox applies its own daily limit per customer)
        "needs_second_factor": needs_second_factor,
        "can_confirm": can_confirm,
        "expires_at": (proposed_at + timedelta(minutes=PLAN_MINUTES)).astimezone(UTC).isoformat().replace("+00:00", "Z"),
    }


def day_cap(runtime: Runtime, ctx: TenantContext, task: TaskOut) -> dict[str, Any] | None:
    """Today's call limit of the business: {limit, used, remaining}, for a plan that places calls; None for a WhatsApp-only plan or when it cannot be read."""
    if runtime.tasks is None or task.plan is None or task.plan.channel not in ("call", "both"):
        return None
    try:
        out = runtime.tasks.call_limit(ctx.principal.token, ctx.tenant.id)
    except Exception:
        return None
    return {"limit": out.limit, "used": out.used, "remaining": out.remaining}


def skipped_people(runtime: Runtime, ctx: TenantContext, task: TaskOut) -> list[dict[str, Any]]:
    """Up to ten of the people a plan skips, for the card ("who is left out"): first name and the closed reason; best effort (the card is still shown without them)."""
    if runtime.tasks is None or task.plan is None or task.plan.consent is None or task.plan.consent.skipped == 0:
        return []
    try:
        out = runtime.tasks.contacts(ctx.principal.token, ctx.tenant.id, task.id, "skipped", 10, None)
    except Exception:
        return []
    return [{"contact_id": str(c.contact_id), "name": (c.display_name or "").split(" ")[0], "reason": c.skip_reason} for c in out.contacts[:10]]


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
            {"select": "id,kind,task_id,sources", "conversation_id": f"eq.{conversation_id}", "role": "eq.assistant", "seq": f"lt.{before_seq}", "order": "seq.desc", "limit": "1"},
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


def _is_light(text: str) -> bool:
    """Small talk and general help are LIGHT runs: one model call, no tools, no records. They do not count against the runs-per-hour allowance, so hands-free live talk cannot use it up.
    Judged on the words alone (the router, without the previous turn); `_dispatch` takes it back when the full decision says the turn reads or changes the business."""
    return classify(text, None).kind in ("smalltalk", "general")


def start_turn(
    runtime: Runtime,
    ctx: TenantContext,
    body: TurnIn,
    *,
    charge: Callable[[AssistantDb], None] | None = None,
    on_reply: Callable[[AssistantDb, str, str], None] | None = None,
    app: Any = None,
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
            input_sha256=_sha({"conversation": str(conversation_id), "message": str(body.message_id), "text": body.text,
                               **({"attachments": [str(a) for a in body.attachment_ids]} if body.attachment_ids else {})}),
            light=_is_light(body.text),
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
        address_as=address_as(runtime, token, tenant),
        region_for=region_for(runtime, token, tenant),
    )
    events: queue.Queue[tuple[str, dict[str, Any]] | None] = queue.Queue()
    reply_id = uuid.uuid4()
    outcome_box: list[Outcome] = []

    def emit(name: str, data: dict[str, Any]) -> None:
        events.put((name, data))

    def work() -> None:
        try:
            outcome_box.append(_dispatch(runtime, ctx, db, body, language, history, last, runner, emit, reply_id, app=app, conversation_id=conversation_id))
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
        if outcome.reply is None and (outcome.shown or outcome.error_code or "tool_failed") in SORRY_CODES:
            yield from sorry_stream(language, reply_id, conversation_id, outcome.error_code or "tool_failed")
        elif outcome.reply is None:
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
    db: AssistantDb,
    body: TurnIn,
    language: Language,
    history: list[dict[str, Any]],
    last: dict[str, Any] | None,
    runner: AssistantRunner,
    emit: Callable[[str, dict[str, Any]], None],
    reply_id: uuid.UUID,
    *,
    app: Any = None,
    conversation_id: uuid.UUID | None = None,
) -> Outcome:
    """Decide the kind, tell the client first, then run the path."""
    # job assistant-does-the-work A2: files dropped with the message: what each is and what to propose, decided by code (no model call); nothing is written before the plan's OK
    from app.assistant_work.enabled import enabled

    work_on = enabled(runtime, ctx.tenant.id)   # ASSISTANT_WORK_TENANTS: the files and the router only in the workspaces that have them; elsewhere the turn is as before
    if body.attachment_ids and work_on:
        emit("intent", {"type": "intent", "kind": "action"})
        logger.info("assistant turn: kind=action reason=files files=%d language=%s", len(body.attachment_ids), language)
        return _file_turn(runtime, ctx, body, language, runner, emit, reply_id, app, conversation_id)
    # the owner's yes or no to the Lead Finder's plan card that the last reply showed (typed, or said to the voice): the search runs or is cancelled, no model call
    if last is not None and last.get("kind") in (None, "answer") and not last.get("task_id") and not last.get("sources") and lf_turn.is_answer(body.text):
        service = lf_turn.available(runtime, ctx)
        search = lf_turn.pending_plan(service, ctx, last) if service is not None else None
        if service is not None and search is not None:
            emit("intent", {"type": "intent", "kind": "action"})
            logger.info("assistant turn: kind=action reason=lead_finder_answer language=%s", language)
            return lf_turn.answer_turn(service, ctx, search, body.text, language, runner, emit, reply_id)
    pending = _pending_question(runtime, ctx, last)
    intent = Intent("action", "answers_question") if pending is not None else classify(body.text, _previous_kind(last))
    # job assistant-does-the-work, the router (owner, 5 Nov 2026): a request about one of the common actions (calling hours, auto-reply, a lead source, one lead, the example data, the screen-only
    # ones) is routed with ONE checked model call to a plan card; anything else, or a request the router says is not its own, goes on exactly as before
    if work_on and pending is None and intent.reason != "find_new_customers" and app is not None and getattr(runtime, "assistant_work", None) is not None:
        from app.assistant_work.router import touches

        if touches(body.text):
            outcome = _route_turn(runtime, ctx, body, language, runner, emit, reply_id, app, conversation_id)
            if outcome is not None:
                return outcome
    if intent.reason == "find_new_customers":
        service = lf_turn.available(runtime, ctx)
        if service is not None:
            emit("intent", {"type": "intent", "kind": intent.kind})
            logger.info("assistant turn: kind=action reason=find_new_customers language=%s", language)
            outcome = lf_turn.plan_turn(service, ctx, body.text, language, runner, emit, reply_id)
            if outcome is not None:
                return outcome
        elif lf_turn.not_in_plan(runtime, ctx):   # a Lead Desk workspace (owner decision 4 Nov 2026): the friendly "part of AI Workforce" card, nothing searched
            emit("intent", {"type": "intent", "kind": "action"})
            logger.info("assistant turn: kind=action reason=find_new_customers not_in_plan language=%s", language)
            return lf_turn.upgrade_turn(language, runner, emit, reply_id)
        # no Lead Finder here (a school, or switched off): the words are decided again without rule 0 and answered as they always were
        intent = classify(body.text, _previous_kind(last), find=False)
    emit("intent", {"type": "intent", "kind": intent.kind})
    logger.info("assistant turn: kind=%s reason=%s language=%s", intent.kind, intent.reason, language)
    if intent.kind in ("smalltalk", "general"):
        if runtime.tasks is not None and _SCHOOL_TOPIC.search(body.text) and runtime.tasks.is_school(runtime, ctx.principal.token, ctx.tenant.id):
            return runner.finish_with(Reply(SCHOOL_REFUSAL[language], language, "answer"), reply_id, emit)
        if intent.reason == "about_assistant":   # "what can you do?": fixed, accurate words, no model call (13 Nov 2026)
            return runner.finish_with(Reply(words.ABOUT_ASSISTANT[language], language, "answer"), reply_id, emit)
        name = _assistant_name(runtime, ctx)
        return runner.run_chat(
            question=body.text, language=language, history=history, emit=emit, message_id=reply_id,
            assistant_name=name, business_name=ctx.tenant.name, small=intent.kind == "smalltalk", owner_notes=runner.owner_notes,
        )
    if intent.kind in ("business", "action") and _is_light(body.text):
        db.mark_heavy()   # opened light on its words alone; the full decision (the turn before it, a pending question) says it reads or changes the business
    if intent.kind == "business":
        return runner.run(question=body.text, language=language, history=history[-BUSINESS_HISTORY:], emit=emit, message_id=reply_id)
    return _run_action(runtime, ctx, body, language, pending, runner, emit, reply_id)


def _file_turn(runtime: Runtime, ctx: TenantContext, body: TurnIn, language: Language, runner: AssistantRunner, emit: Callable[[str, dict[str, Any]], None], reply_id: uuid.UUID,
               app: Any, conversation_id: uuid.UUID | None) -> Outcome:
    from app.assistant_work.service import FileTurn, Tools, words

    store = getattr(runtime, "assistant_work", None)
    if store is None or app is None:
        return runner.finish_with(Reply(words("gone", language), language, "answer"), reply_id, emit)
    emit("step", {"type": "step", "step": "working"})
    from app.assistant_work.planner import plan as plan_file
    from app.assistant_work.planner import wants_import
    from app.assistant_work.vision import model_vision

    token, tenant = ctx.principal.token, ctx.tenant.id
    tasks = runtime.tasks
    # owner rules (5 Nov 2026): a scanned page is read by local OCR first; the AI model reads it only when that found nothing, and never in a school's workspace
    turn = FileTurn(store, Tools(app), runtime.lead_sources, reader=getattr(runtime, "assistant_file_reader", None), school=(lambda: tasks is None or tasks.is_school(runtime, token, tenant)), vision=model_vision(runtime, token, tenant))
    sentences: list[str] = []
    cards: list[tuple[str, dict[str, Any]]] = []
    # job A2b (owner, 5 Nov 2026): a request that is not plainly "add these" is planned with the model from what the file holds; a school's files never reach the model (fails closed)
    planned = not wants_import(body.text) and not (tasks is None or _school_or_unknown(tasks, runtime, token, tenant))
    for file_id in body.attachment_ids[:5]:
        try:
            if planned:
                sentence, card = turn.with_request(token, tenant, file_id, body.text or "", plan_with=lambda u, req, lang: plan_file(runtime, token, tenant, u, req, lang), message_id=reply_id,
                                                   conversation_id=conversation_id, language=language)
            else:
                sentence, card = turn.answer(ctx.principal.token, ctx.tenant.id, file_id, message_id=reply_id, conversation_id=conversation_id, language=language)
        except Exception as exc:   # one file that could not be handled does not lose the others
            logger.warning("assistant file turn failed: %s", exc.__class__.__name__)
            sentence, card = words("unreadable", language, name="file"), None
        sentences.append(sentence)
        if card is not None:
            cards.append(("work_card", {"card": card}))
    return runner.finish_with(Reply(" ".join(sentences), language, "answer"), reply_id, emit, extra=tuple(cards))


def _route_turn(runtime: Runtime, ctx: TenantContext, body: TurnIn, language: Language, runner: AssistantRunner, emit: Callable[[str, dict[str, Any]], None], reply_id: uuid.UUID,
                app: Any, conversation_id: uuid.UUID | None) -> Outcome | None:
    """The router's answer, or None when the request is not one of the common actions (or the router cannot be asked): the turn then goes on as before."""
    from app.assistant_work.routed import RouteTurn
    from app.assistant_work.router import route
    from app.assistant_work.service import Tools

    token, tenant = ctx.principal.token, ctx.tenant.id
    try:
        routed = route(runtime, token, tenant, body.text, language)
    except ApiError as exc:
        logger.info("assistant route not asked: %s", exc.code)
        return None
    if routed.decision == "not_mine":
        return None
    emit("intent", {"type": "intent", "kind": "action"})
    logger.info("assistant turn: kind=action reason=routed decision=%s action=%s language=%s", routed.decision, routed.action or "-", language)
    emit("step", {"type": "step", "step": "working"})
    try:
        sentence, card = RouteTurn(runtime.assistant_work, Tools(app), runtime.lead_sources, getattr(runtime, "workspace_secrets", None)).answer(token, tenant, routed, message_id=reply_id, conversation_id=conversation_id, language=language,
                                                                                                                                  manager=ctx.role in (Role.OWNER, Role.ADMIN))
    except Exception as exc:   # a step that could not be prepared: said plainly, nothing done
        logger.warning("assistant routed request not prepared: %s", exc.__class__.__name__)
        from app.assistant_work.routed import w

        sentence, card = w("unavailable", language), None
    kind = "clarify" if routed.decision == "clarify" else "answer"
    return runner.finish_with(Reply(sentence, language, kind), reply_id, emit, extra=(("work_card", {"card": card}),) if card is not None else ())


def _school_or_unknown(tasks: Any, runtime: Runtime, token: str, tenant: uuid.UUID) -> bool:
    try:
        return bool(tasks.is_school(runtime, token, tenant))
    except Exception:
        return True


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
        payload = confirm_payload(task, language, needs_second_factor=_needs_second_factor(runtime, ctx), can_confirm=ctx.role == Role.OWNER, proposed_at=datetime.now(UTC), skipped_sample=skipped_people(runtime, ctx, task), daily_cap=day_cap(runtime, ctx, task))
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
                    payload = confirm_payload(task, shown, needs_second_factor=_needs_second_factor(runtime, ctx), can_confirm=ctx.role == Role.OWNER, proposed_at=proposed_at, skipped_sample=skipped_people(runtime, ctx, task), daily_cap=day_cap(runtime, ctx, task))
                    payload["status"] = action_status(task.status, proposed_at, datetime.now(UTC))
                    yield _sse("confirm_action", {"type": "confirm_action", **payload})
            except Exception:
                logger.warning("assistant replay: the plan card could not be rebuilt")
        elif kind == "answer" and not reply.get("sources"):
            for lf_card in lf_turn.cards_for(runtime, ctx, [str(reply["id"])]).values():
                yield _sse("lead_finder", {"type": "lead_finder", **lf_card})
            from app.assistant_work.service import cards_for as work_cards_for

            for work_card in work_cards_for(runtime, ctx, [str(reply["id"])]).get(str(reply["id"]), []):
                yield _sse("work_card", {"type": "work_card", "card": work_card})
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


def confirm_decision(runtime: Runtime, ctx: TenantContext, task_id: uuid.UUID, decision: str, schedule: Callable[..., Any], second_confirm: bool = False) -> ConfirmOut:
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
        cap = day_cap(runtime, ctx, task)
        if cap is not None and task.plan is not None and task.plan.contacts_total > cap["remaining"]:   # the plan would go beyond today's call limit: refused here (and the runner stops at it too)
            text = _spoken(words.DAILY_CAP_EXCEEDED, task.language)
            raise ApiError(409, "daily_cap_exceeded", text.format(limit=cap["limit"], used=cap["used"], remaining=cap["remaining"], count=task.plan.contacts_total))
        if task.plan is not None and task.plan.needs_second_confirm and not second_confirm:   # a big plan (more than 50 people): the server asks again, whatever the screen did
            raise ApiError(409, "second_yes_required", second_confirm_words(task.language, task.plan.channel, task.plan.contacts_total))
        task = tasks.approve(token, tenant, task_id, task.plan_sha256, None)
        schedule(tasks.run, runtime, token, tenant, ctx.tenant.name, task.id)
        state = "confirmed"
    return ConfirmOut(action_id=task_id, status=state, task=TaskRef(id=task.id, status=task.status))  # type: ignore[arg-type]


def _left_out(runtime: Runtime, ctx: TenantContext, task_id: uuid.UUID, only: list[uuid.UUID] | None) -> list[Any]:
    """The people a plan skipped because their consent is not known ("ask first"), at most 500, optionally only these contact ids. People who withdrew (`opted_out`) are never in it."""
    assert runtime.tasks is not None   # noqa: S101
    found: list[Any] = []
    after: int | None = None
    for _ in range(3):
        page = runtime.tasks.contacts(ctx.principal.token, ctx.tenant.id, task_id, "skipped", 200, after)
        found += [c for c in page.contacts if c.skip_reason == "no_consent"]
        if page.next_cursor is None:
            break
        after = int(page.next_cursor)
    if only is not None:
        wanted = set(only)
        found = [c for c in found if c.contact_id in wanted]
    return found


def ask_consent(runtime: Runtime, ctx: TenantContext, task_id: uuid.UUID, body: AskConsentIn) -> AskConsentOut:
    """"Ask first" (owner, 14 Nov 2026): a plan reaches only people who gave consent; the people with unknown consent are listed and can be asked here. Raises ApiError: 404, 409 `action_state`
    (the plan is not waiting for a yes any more), 422 `nobody_to_ask`, 403 `mfa_required` (`owner_confirms` needs the second factor)."""
    from app.errors import mfa_required
    from app.tasks import compose
    from app.tasks.models import PlanIn
    from app.tenancy.repository import RepositoryError

    tasks = runtime.tasks
    if tasks is None:
        raise ApiError(503, "tasks_unavailable", "Tasks are not available right now.")
    token, tenant = ctx.principal.token, ctx.tenant.id
    task = tasks.get(token, tenant, task_id)
    if task.status != "planned" or task.plan is None:
        raise ApiError(409, "action_state", "That plan is not waiting for a yes any more.")
    if not body.all_skipped and not body.contact_ids:
        raise ApiError(422, "nobody_to_ask", "Say who to ask, or ask everyone who is left out.")
    targets = _left_out(runtime, ctx, task_id, None if body.all_skipped else body.contact_ids)
    if not targets:
        raise ApiError(422, "nobody_to_ask", "Nobody left out needs asking.")
    if body.how == "owner_confirms":
        if _needs_second_factor(runtime, ctx):
            raise mfa_required("second_factor")
        for c in targets:
            tasks.record_consent(token, tenant, c.contact_id, task_id)
        # the plan is made again from the same words, with these people in; the old one is cancelled (a plan is never changed under the tap)
        from app.tasks.routes import _refusal as task_refusal

        fresh = tasks.plan(runtime, token, tenant, ctx.tenant.name, PlanIn(instruction=task.instruction, language=task.language), task_refusal(runtime, ctx))
        tasks.set_state(token, tenant, task_id, "cancel")
        card = None
        if fresh.plan is not None and fresh.status == "planned":
            card = confirm_payload(fresh, task.language, needs_second_factor=_needs_second_factor(runtime, ctx), can_confirm=True, proposed_at=datetime.now(UTC),
                                   skipped_sample=skipped_people(runtime, ctx, fresh), daily_cap=day_cap(runtime, ctx, fresh))
        return AskConsentOut(how="owner_confirms", asked=len(targets), new_action=card)
    outbox = runtime.outbox
    if outbox is None:
        raise ApiError(503, "outbox_unavailable", "Messages are not available right now.")
    queued, blocked = 0, 0
    reasons: dict[str, int] = {}
    text = compose.consent_ask_text(task.language, ctx.tenant.name)
    for c in targets:
        if c.lead_id is None:
            continue
        args = {"p_message_id": str(compose.message_id(task_id, c.contact_id, "consent")), "p_tenant_id": str(tenant), "p_lead_id": str(c.lead_id), "p_channel": "whatsapp",
                "p_body": text, "p_language": task.language, "p_category": "info", "p_source": "assistant", "p_model_flagged": False, "p_uncertain": False}
        try:
            answer = outbox.submit(token, args)
        except RepositoryError:
            blocked += 1
            reasons["refused"] = reasons.get("refused", 0) + 1
            continue
        if str(answer.get("status")) in ("queued", "needs_approval", "sent"):
            queued += 1
        else:
            blocked += 1
            why = str(answer.get("reason") or "blocked")
            reasons[why] = reasons.get(why, 0) + 1
    return AskConsentOut(how="whatsapp", asked=queued + blocked, queued=queued, blocked=blocked, blocked_reasons=reasons)
