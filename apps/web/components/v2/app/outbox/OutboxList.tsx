"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import type { OutboxEvent, OutboxMessage, OutboxSummary } from "@/lib/api/outbox";

import { MessagePhotos } from "../catalogue/MessagePhotos";
import { OrbMark } from "../mark/OrbMark";
import type { DecisionResult } from "../today/actions-types";
import { say, type TodayWords } from "../today/today-words";
import type { Role } from "../today/types";
import { badge, card, errorLine, field, label as fieldLabel, okLine, primary, quiet, secondary } from "../visits/styles";
import { firstLine, reasonKey, toneOf, type OutboxTab } from "./reasons";
import { eventLines, type QuietHours } from "./outbox-events";
import { stamp } from "./outbox-time";

export type OutboxActions = {
  approve: (id: string) => Promise<DecisionResult>;
  reject: (id: string) => Promise<DecisionResult>;
  edit: (id: string, text: string) => Promise<DecisionResult>;
  /** Hand what is due to the channel now. */
  dispatch: () => Promise<DecisionResult>;
  /** The real history of one message (its events), read when its row is opened. */
  detail: (id: string) => Promise<{ ok: true; events: OutboxEvent[] } | { ok: false }>;
};

type Ctx = { words: TodayWords; lang: string; now: number; role: Role; quiet: QuietHours; actions: OutboxActions | null; leadHref: (id: string) => string; decide: (id: string, run: () => Promise<DecisionResult>) => Promise<void>; problems: Readonly<Record<string, NonNullable<Problem>>> };
type Problem = { text: string; mfa: boolean } | null;
const MAX_WORDS = 3000;

/** The moment a row is about: when it goes out (held), when it went, or when it was made. */
function when(m: OutboxMessage, ctx: Ctx): string {
  if (m.status === "queued" && m.scheduled_for && Date.parse(m.scheduled_for) > ctx.now) return say(ctx.words, "outbox.goes", { time: stamp(m.scheduled_for, ctx.now, ctx.lang) });
  return stamp(m.status === "sent" && m.sent_at ? m.sent_at : m.created_at, ctx.now, ctx.lang);
}

type Step = { at: string; key: string; vars?: Record<string, string | number> };

/** What happened to a message, oldest first, made from the times the message carries: the FALLBACK shown while the real history (the events) is being read, or if it cannot be read. */
export function historyOf(m: OutboxMessage, ctx: { words: TodayWords; now: number; lang: string }): { at: string; text: string }[] {
  const steps: Step[] = [{ at: m.created_at, key: `outbox.hist.made.${m.source}` }];
  if (m.edited_at) steps.push({ at: m.edited_at, key: "outbox.hist.edited" });
  if (m.decided_at) steps.push({ at: m.decided_at, key: m.reason === "owner_rejected" ? "outbox.hist.rejected" : "outbox.hist.approved" });
  if (m.status === "needs_approval") steps.push({ at: m.created_at, key: "outbox.hist.waiting" });
  if (m.status === "queued" && m.scheduled_for) steps.push({ at: m.scheduled_for, key: "outbox.hist.held" });
  if (m.status === "sent" && m.sent_at) steps.push({ at: m.sent_at, key: "outbox.hist.sent" });
  if (m.status === "failed") steps.push({ at: m.decided_at ?? m.created_at, key: "outbox.hist.failed" });
  if (m.status === "blocked" && m.reason !== "owner_rejected") steps.push({ at: m.decided_at ?? m.created_at, key: "outbox.hist.blocked" });
  return steps
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .map((s) => ({ at: s.at, text: `${stamp(s.at, ctx.now, ctx.lang)} · ${say(ctx.words, s.key, { reason: say(ctx.words, reasonKey(m.reason)) })}` }));
}

function Row({ m, ctx, open, onToggle }: { m: OutboxMessage; ctx: Ctx; open: boolean; onToggle: () => void }) {
  const { words } = ctx;
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [text, setText] = React.useState(m.text);
  // new words make the old English gloss untrue: the API clears it when the words are edited without a new one, so the row stops showing it too
  const [gloss, setGloss] = React.useState(m.gloss_en);
  const [busy, setBusy] = React.useState(false);
  const [local, setProblem] = React.useState<Problem>(null);
  const problem = local ?? ctx.problems[m.id] ?? null;
  const customer = m.customer ?? say(words, "today.customer.unknown");
  // the real history, read the first time the row is opened (in the click, not in an effect); until then, or if it cannot be read, the one made from the message's own times
  const [events, setEvents] = React.useState<OutboxEvent[] | "loading" | "failed" | null>(null);
  function loadHistory() {
    if (events !== null || ctx.actions === null) return;
    setEvents("loading");
    ctx.actions.detail(m.id).then(
      (r) => setEvents(r.ok ? r.events : "failed"),
      () => setEvents("failed"),
    );
  }
  const decidable = (ctx.role === "owner" || ctx.role === "admin") && ctx.actions !== null && m.status === "needs_approval";
  const bodyId = `outbox-${m.id}`;

  async function run(call: () => Promise<DecisionResult>, onOk?: (r: Extract<DecisionResult, { ok: true }>) => void) {
    setBusy(true);
    setProblem(null);
    let r: DecisionResult;
    try {
      r = await call();
    } catch {
      r = { ok: false, error: say(words, "today.err.generic") };
    }
    setBusy(false);
    if (r.ok) onOk?.(r);
    else setProblem({ text: r.error || say(words, "today.err.generic"), mfa: r.mfa === true });
  }

  return (
    <li className="flex flex-col rounded-[20px] border border-line bg-surface" data-write data-status={m.status} data-reason={m.reason}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => {
          if (!open) loadHistory();
          onToggle();
        }} className="flex w-full min-w-0 flex-col gap-2 rounded-[20px] p-4 text-left hover:bg-surface-2 md:p-5">
        <span className="flex flex-wrap items-center gap-2">
          <span className={`${badge} ${toneOf(m)}`}>{say(words, reasonKey(m.reason))}</span>
          <span className="text-sm text-muted">{say(words, "outbox.channel")}</span>
          <span className="text-sm text-muted">{say(words, `today.lang.${m.language}`)}</span>
          <span className="ml-auto text-sm tabular-nums text-muted">{when(m, ctx)}</span>
          <ChevronDown className={`size-5 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
        </span>
        <span className="text-lg font-semibold leading-snug [overflow-wrap:anywhere]">
          {customer}
          {m.city ? <span className="font-normal text-muted"> · {m.city}</span> : null}
        </span>
        <span lang={m.language} className="line-clamp-1 text-base text-muted [overflow-wrap:anywhere]">
          {firstLine(text)}
        </span>
      </button>
      {m.media.length > 0 ? (
        <div className="px-4 pb-3 md:px-5">
          <MessagePhotos media={m.media} words={words} size={open ? "md" : "sm"} />
        </div>
      ) : null}
      {open ? (
        <div id={bodyId} className="flex flex-col gap-3 border-t border-line p-4 md:p-5">
          {editing ? (
            <div className="flex flex-col gap-2">
              <label htmlFor={`${bodyId}-edit`} className={fieldLabel}>
                {say(words, "today.edit.label")}
              </label>
              <textarea id={`${bodyId}-edit`} lang={m.language} value={draft} maxLength={MAX_WORDS} rows={6} onChange={(e) => setDraft(e.target.value)} className={`${field} min-h-32 py-2`} />
              <p className="text-sm text-muted">{say(words, "today.edit.hint")}</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy || draft.trim().length < 2}
                  onClick={() =>
                    void run(
                      () => ctx.actions!.edit(m.id, draft),
                      (r) => {
                        setText(r.text ?? draft.trim());
                        setGloss(null);
                        setEditing(false);
                      },
                    )
                  }
                  className={primary}
                >
                  {busy ? say(words, "today.act.working") : say(words, "today.act.save")}
                </button>
                <button type="button" disabled={busy} onClick={() => setEditing(false)} className={quiet}>
                  {say(words, "today.act.cancel")}
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl rounded-bl-sm bg-surface-2 px-4 py-3.5">
              <p lang={m.language} className="whitespace-pre-wrap text-base [overflow-wrap:anywhere]">
                {text}
              </p>
              {m.disclosure_added ? <p className="mt-2 text-sm text-muted">{say(words, "outbox.disclosure")}</p> : null}
            </div>
          )}
          {gloss && !editing ? (
            <div data-part="gloss" className="rounded-2xl border border-line px-4 py-3">
              <p className="text-sm font-semibold text-muted">{say(words, "outbox.gloss")}</p>
              <p lang="en" className="mt-1 whitespace-pre-wrap text-base [overflow-wrap:anywhere]">
                {gloss}
              </p>
            </div>
          ) : null}
          <p className="text-sm text-muted">{say(words, "outbox.why", { reason: m.reason_text })}</p>
          {m.flags.length > 0 ? (
            <ul className="flex flex-wrap gap-2">
              {m.flags.map((f) => (
                <li key={f} className={`${badge} bg-surface-2 text-ink`}>
                  {say(words, `outbox.flag.${f}`)}
                </li>
              ))}
            </ul>
          ) : null}
          {m.failure_code ? <p className="text-sm font-medium text-red-text">{say(words, `outbox.failure.${m.failure_code}`)}</p> : null}
          <div>
            <h2 className="mb-1.5 text-sm font-semibold">{say(words, "outbox.history")}</h2>
            {events === "loading" ? <p className="text-sm text-muted">{say(words, "today.act.working")}</p> : null}
            <ol className="flex flex-col gap-1 border-l-2 border-line pl-3 text-sm" aria-label={say(words, "outbox.history")} data-history={Array.isArray(events) ? "events" : "derived"}>
              {(Array.isArray(events) ? eventLines(events, words, ctx.now, ctx.lang, ctx.quiet) : historyOf(m, ctx)).map((h, i) => (
                <li key={`${h.at}-${i}`} className="[overflow-wrap:anywhere]">
                  {h.text}
                </li>
              ))}
            </ol>
          </div>
          {problem ? (
            <p role="alert" className={errorLine}>
              {problem.text}
              {problem.mfa ? (
                <>
                  {" "}
                  <Link href="/app/security" className="font-semibold underline">
                    {say(words, "today.err.mfa.link")}
                  </Link>
                </>
              ) : null}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {decidable && !editing ? (
              <>
                <button type="button" disabled={busy} onClick={() => void ctx.decide(m.id, () => ctx.actions!.approve(m.id))} className={`${primary} max-md:grow`}>
                  {say(words, "today.act.approve")}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setDraft(text);
                    setProblem(null);
                    setEditing(true);
                  }}
                  className={secondary}
                >
                  {say(words, "today.act.edit")}
                </button>
                <button type="button" disabled={busy} onClick={() => void ctx.decide(m.id, () => ctx.actions!.reject(m.id))} className={quiet}>
                  {say(words, "today.act.notnow")}
                </button>
              </>
            ) : null}
            {m.status === "needs_approval" && !decidable ? <p className="text-sm text-muted">{say(words, "outbox.owneronly")}</p> : null}
            <Link href={ctx.leadHref(m.lead_id)} className="ml-auto inline-flex min-h-11 items-center text-sm font-semibold text-brand-text hover:underline">
              {say(words, "outbox.openlead")}
            </Link>
          </div>
        </div>
      ) : null}
    </li>
  );
}

/**
 * The rows of one Outbox tab (job AX): the customer, the channel, the first line of the words, the language, a chip saying in plain words why the message is in the state it is in, and the time. A row opens in place
 * to the full words, the flags, the history made from the times the API gives and, for a message waiting for a person who may decide it (Owner and Admin), Approve and send / Edit / Not now. Approving needs the second
 * factor (the refusal says so and points at Security). A decision takes the row off the list at once and a note says what really happened; a refusal puts it back with the reason. In the Scheduled tab the Owner and Admin
 * also have "Send what is due now". Nothing here shows a number: the API gives none.
 */
export function OutboxList({ items, tab, role, words, lang, now, actions, leadBase, counts = null, quiet = null, filtered = false }: { items: readonly OutboxMessage[]; tab: OutboxTab; role: Role; words: TodayWords; lang: string; now: number; actions: OutboxActions | null; leadBase: string; counts?: OutboxSummary | null; quiet?: QuietHours; filtered?: boolean }) {
  const router = useRouter();
  const [hidden, setHidden] = React.useState<ReadonlySet<string>>(new Set());
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [problems, setProblems] = React.useState<Record<string, NonNullable<Problem>>>({});

  // a decision takes its row off at once; a refusal puts it back
  const decide = React.useCallback(
    async (id: string, run: () => Promise<DecisionResult>): Promise<void> => {
      setHidden((h) => new Set(h).add(id));
      setNote(null);
      setProblems((p) => {
        const next = { ...p };
        delete next[id];
        return next;
      });
      let r: DecisionResult;
      try {
        r = await run();
      } catch {
        r = { ok: false, error: "" };
      }
      if (r.ok) setNote({ ok: true, text: r.message });
      else {
        setProblems((p) => ({ ...p, [id]: { text: r.error || say(words, "today.err.generic"), mfa: r.mfa === true } }));
        setHidden((h) => {
          const next = new Set(h);
          next.delete(id);
          return next;
        });
        if (r.stale) router.refresh();
      }
    },
    [router, words],
  );
  const ctx: Ctx = { words, lang, now, role, quiet, actions, leadHref: (id) => `${leadBase}/${id}`, decide, problems };
  const shown = items.filter((m) => !hidden.has(m.id));
  const may = (role === "owner" || role === "admin") && actions !== null;

  return (
    <div className="flex flex-col gap-3">
      {tab === "scheduled" && may ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setNote(null);
              let r: DecisionResult;
              try {
                r = await actions!.dispatch();
              } catch {
                r = { ok: false, error: say(words, "today.err.generic") };
              }
              setBusy(false);
              setNote(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error || say(words, "today.err.generic") });
              if (r.ok) router.refresh();
            }}
            className={secondary}
          >
            {busy ? say(words, "today.act.working") : say(words, "outbox.dispatch")}
          </button>
          <p className="text-sm text-muted" data-part="due-line">
            {counts ? say(words, "outbox.due.line", { due: counts.due_now, held: counts.held_for_later }) : say(words, "outbox.dispatch.hint")}
          </p>
        </div>
      ) : null}
      <div role="status" aria-live="polite">
        {note ? <p className={note.ok ? okLine : errorLine}>{note.text}</p> : null}
      </div>
      {shown.length === 0 ? (
        <div className={`${card} flex-row items-center`} data-empty={tab}>
          <OrbMark px={56} mood={"idle"} className="size-14" />
          <p className="font-medium">{say(words, filtered ? "outbox.empty.filtered" : `outbox.empty.${tab}`)}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {shown.map((m) => (
            <Row key={m.id} m={m} ctx={ctx} open={openId === m.id} onToggle={() => setOpenId((cur) => (cur === m.id ? null : m.id))} />
          ))}
        </ul>
      )}
    </div>
  );
}
