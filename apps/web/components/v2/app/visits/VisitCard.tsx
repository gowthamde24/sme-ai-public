"use client";

import Link from "next/link";
import * as React from "react";

import { formatINR } from "@/design/format";
import type { Visit, VisitOutcome, VisitStatus } from "@/lib/api/visits";

import { say, type TodayWords } from "../today/today-words";
import { indiaClock } from "../today/time";
import type { Role } from "../today/types";
import type { StepResult, VisitsActions } from "./actions-types";
import { SlotPicker, type SlotChoice } from "./SlotPicker";
import { badge, card, danger, errorLine, field, help, label, okLine, primary, quiet, secondary } from "./styles";

const TONE: Record<VisitStatus, string> = {
  booked: "bg-amber-bg text-amber-text",
  confirmed: "bg-green-bg text-green-text",
  arrived: "bg-brand-bg text-brand-text",
  completed: "bg-surface-2 text-ink",
  no_show: "bg-red-bg text-red-text",
  cancelled: "bg-surface-2 text-muted",
};
const OUTCOMES: readonly VisitOutcome[] = ["bought", "will_return", "not_interested"];

type Mode = "idle" | "move" | "cancel" | "complete";

/** The sentence under a refusal: where the person can go from here. */
function Problem({ words, error, base }: { words: TodayWords; error: Extract<StepResult, { ok: false }>; base: string }) {
  return (
    <p role="alert" className={errorLine}>
      {error.error}
      {error.mfa ? (
        <>
          {" "}
          <Link href="/app/security" className="font-semibold underline">
            {say(words, "today.err.mfa.link")}
          </Link>
        </>
      ) : null}
      {error.quotes ? (
        <>
          {" "}
          <Link href={`${base}/quotes`} className="font-semibold underline">
            {say(words, "visits.err.quotes.link")}
          </Link>
        </>
      ) : null}
    </p>
  );
}

/**
 * One visit on the Visits page (job AV): who, when, how many, why, where it stands, and the buttons that fit where it stands. A visit moves one step at a time (the API checks again):
 * booked: Confirm, Arrived, Change time, Cancel, Did not come (after its time); confirmed: Arrived, Change time, Cancel, Did not come; arrived: Complete with how it ended; the rest have none.
 * Everyone but a Viewer sees the buttons. "Bought" can also start the order from the customer's approved quote, which only an Owner or Admin may do and which needs the second factor: the refusal says so
 * in words, and when there is no approved quote it points at the quotes. A refusal never changes the card; a success says what happened (nothing is sent to the customer by any button here).
 */
export function VisitCard({ visit: v, role, actions, words, lang, now, today, base, slotsMin }: { visit: Visit; role: Role; actions: VisitsActions; words: TodayWords; lang: string; now: number; today: string; base: string; slotsMin: string }) {
  const [mode, setMode] = React.useState<Mode>("idle");
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<Extract<StepResult, { ok: false }> | null>(null);
  const [done, setDone] = React.useState<{ message: string; orderId?: string } | null>(null);
  const [pick, setPick] = React.useState<SlotChoice>({ date: v.date, slot: null });
  const [reason, setReason] = React.useState("");
  const orderId = React.useRef<string | null>(null);

  const canAct = role !== "viewer";
  const canOrder = role === "owner" || role === "admin";
  const started = Date.parse(v.starts_at) <= now;

  async function run(call: () => Promise<StepResult>) {
    setBusy(true);
    setProblem(null);
    setDone(null);
    let result: StepResult;
    try {
      result = await call();
    } catch {
      result = { ok: false, error: say(words, "today.err.generic") };
    }
    setBusy(false);
    if (result.ok) {
      setMode("idle");
      setDone({ message: result.message, orderId: result.orderId });
    } else {
      setProblem(result);
    }
  }

  const statusWord = say(words, `visits.status.${v.status}`);
  return (
    <article aria-labelledby={`visit-${v.id}`} data-write data-status={v.status} className={card}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`${badge} ${TONE[v.status]}`}>{v.status === "booked" && v.source === "assistant" ? say(words, "visits.status.proposed") : statusWord}</span>
        {v.status === "confirmed" && v.reminder_sent ? <span className={`${badge} bg-surface-2 text-muted`}>{say(words, "visits.status.reminder")}</span> : null}
        {v.source === "assistant" && v.status !== "booked" ? <span className={`${badge} bg-surface-2 text-muted`}>{say(words, "visits.source.assistant")}</span> : null}
        {v.outcome ? <span className={`${badge} bg-surface-2 text-ink`}>{say(words, `visits.outcome.${v.outcome}`)}</span> : null}
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 id={`visit-${v.id}`} className="text-lg font-semibold leading-snug [overflow-wrap:anywhere]">
          {v.who}
          {v.party_size > 1 ? ` + ${v.party_size - 1}` : ""}
          {v.city ? <span className="font-normal text-muted"> · {v.city}</span> : null}
        </h3>
        <span className="font-bold tabular-nums">
          {indiaClock(v.starts_at)}
          <span className="font-normal text-muted"> – {indiaClock(v.ends_at)}</span>
        </span>
      </div>
      <p className="text-sm text-muted">{say(words, v.party_size === 1 ? "visits.party.one" : "visits.party.other", { n: v.party_size })}</p>
      {v.customer && v.customer !== v.who ? <p className="text-base [overflow-wrap:anywhere]">{v.customer}</p> : null}
      {v.purpose ? <p className="text-base [overflow-wrap:anywhere]">{v.purpose}</p> : null}
      {v.note ? <p className="whitespace-pre-wrap rounded-2xl bg-surface-2 px-3.5 py-3 text-base [overflow-wrap:anywhere]">{v.note}</p> : null}
      {v.advance_requested && v.advance_paise !== null ? <p className="text-sm text-muted">{say(words, "visits.advance", { amount: formatINR(v.advance_paise / 100, { decimals: 2 }) })}</p> : null}
      {v.status === "cancelled" && v.cancel_reason ? <p className="text-sm text-muted [overflow-wrap:anywhere]">{say(words, "visits.cancelled.reason", { reason: v.cancel_reason })}</p> : null}
      {v.order_id ? (
        <p>
          <Link href={`${base}/orders/${v.order_id}`} className="inline-flex min-h-11 items-center font-semibold text-brand-text hover:underline">
            {say(words, "visits.order.open")}
          </Link>
        </p>
      ) : null}

      {done ? (
        <p role="status" className={okLine}>
          {done.message}
          {done.orderId ? (
            <>
              {" "}
              <Link href={`${base}/orders/${done.orderId}`} className="font-semibold underline">
                {say(words, "visits.order.open")}
              </Link>
            </>
          ) : null}
        </p>
      ) : null}
      {problem ? <Problem words={words} error={problem} base={base} /> : null}

      {mode === "move" ? (
        <div className="flex flex-col gap-3 rounded-2xl bg-surface-2 p-3.5">
          <p className="font-semibold">{say(words, "visits.move.title")}</p>
          <SlotPicker words={words} lang={lang} min={slotsMin} value={pick} onChange={setPick} load={actions.slots} idPrefix={`move-${v.id}`} />
          <p className="text-sm text-muted">{say(words, "visits.move.hint")}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy || pick.slot === null} onClick={() => void run(() => actions.move(v.id, pick.date, pick.slot as string))} className={primary}>
              {busy ? say(words, "today.act.working") : say(words, "visits.act.move")}
            </button>
            <button type="button" disabled={busy} onClick={() => setMode("idle")} className={quiet}>
              {say(words, "today.act.cancel")}
            </button>
          </div>
        </div>
      ) : null}

      {mode === "cancel" ? (
        <div className="flex flex-col gap-2 rounded-2xl bg-surface-2 p-3.5">
          <label htmlFor={`reason-${v.id}`} className={label}>
            {say(words, "visits.cancel.reason")}
          </label>
          <input id={`reason-${v.id}`} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} className={field} />
          <p className={help}>{say(words, "visits.cancel.hint")}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => void run(() => actions.cancel(v.id, reason.trim()))} className={danger}>
              {busy ? say(words, "today.act.working") : say(words, "visits.act.cancel.confirm")}
            </button>
            <button type="button" disabled={busy} onClick={() => setMode("idle")} className={quiet}>
              {say(words, "visits.act.keep")}
            </button>
          </div>
        </div>
      ) : null}

      {mode === "complete" ? (
        <div className="flex flex-col gap-3 rounded-2xl bg-surface-2 p-3.5">
          <p className="font-semibold">{say(words, "visits.complete.title")}</p>
          <div className="flex flex-col gap-2">
            {canOrder ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  orderId.current ??= crypto.randomUUID();
                  void run(() => actions.complete(v.id, "bought", orderId.current));
                }}
                className={`${primary} !whitespace-normal text-left`}
              >
                {say(words, "visits.complete.order")}
              </button>
            ) : null}
            {OUTCOMES.map((o) => (
              <button key={o} type="button" disabled={busy} onClick={() => void run(() => actions.complete(v.id, o, null))} className={`${secondary} !whitespace-normal`}>
                {say(words, o === "bought" ? "visits.complete.bought" : `visits.outcome.${o}`)}
              </button>
            ))}
          </div>
          <p className="text-sm text-muted">{say(words, canOrder ? "visits.complete.hint" : "visits.complete.hint.sales")}</p>
          <button type="button" disabled={busy} onClick={() => setMode("idle")} className={`${quiet} self-start`}>
            {say(words, "today.act.cancel")}
          </button>
        </div>
      ) : null}

      {canAct && mode === "idle" && (v.status === "booked" || v.status === "confirmed" || v.status === "arrived") ? (
        <div className="flex flex-wrap gap-2">
          {v.status === "booked" ? (
            <button type="button" disabled={busy} onClick={() => void run(() => actions.confirm(v.id))} className={`${primary} max-md:grow`}>
              {say(words, "visits.act.confirm")}
            </button>
          ) : null}
          {(v.status === "booked" || v.status === "confirmed") && v.date === today ? (
            <button type="button" disabled={busy} onClick={() => void run(() => actions.arrive(v.id))} className={v.status === "confirmed" ? `${primary} max-md:grow` : secondary}>
              {say(words, "visits.act.arrive")}
            </button>
          ) : null}
          {v.status === "arrived" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setProblem(null);
                setDone(null);
                setMode("complete");
              }}
              className={`${primary} max-md:grow`}
            >
              {say(words, "visits.act.complete")}
            </button>
          ) : null}
          {v.status !== "arrived" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setPick({ date: v.date, slot: null });
                setProblem(null);
                setDone(null);
                setMode("move");
              }}
              className={secondary}
            >
              {say(words, "visits.act.change")}
            </button>
          ) : null}
          {v.status !== "arrived" && started ? (
            <button type="button" disabled={busy} onClick={() => void run(() => actions.noShow(v.id))} className={secondary}>
              {say(words, "visits.act.noshow")}
            </button>
          ) : null}
          {v.status !== "arrived" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setProblem(null);
                setDone(null);
                setMode("cancel");
              }}
              className={quiet}
            >
              {say(words, "visits.act.cancel")}
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
