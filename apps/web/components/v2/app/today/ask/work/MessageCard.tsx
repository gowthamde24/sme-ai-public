"use client";

import { Check, CheckCheck, MessageCircle } from "lucide-react";
import * as React from "react";

import type { MessageCard as Card } from "@/lib/assistant-work/types";

import { btnSmall, cardBox, type WorkEnv } from "./work-env";

const POLL_MS = 4000;
const MAX_POLLS = 45; // about three minutes: a receipt that never comes is not waited for forever

type Phase = "held" | "queued" | "sent" | "failed" | "undone" | "manual";

const secondsLeft = (until: string | null, now: number): number => (until === null ? 0 : Math.max(0, Math.ceil((Date.parse(until) - now) / 1000)));

/**
 * A message the assistant sent on the owner's own words ("send Kalyani: how are you?" IS the approval, owner 14 Nov): who, the exact words, and where it is: held for a moment with Undo and the seconds left, on its way, sent
 * (then the receipts: delivered, read), failed, taken back, or "manual": WhatsApp can only reach the test numbers until App Review, nothing was submitted, with "Open in your WhatsApp" when the message has an approved copy to open.
 * It never says "sent" before the outbox does: while held the line is "Sending to Kalyani in 24 s".
 */
export function MessageCard({ card, env }: { card: Card; env: WorkEnv }) {
  const { t, transport } = env;
  const [now, setNow] = React.useState(() => Date.now());
  const [undone, setUndone] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [seen, setSeen] = React.useState<{ status: "queued" | "sent" | "blocked" | "failed" | "waiting"; delivery: "sent" | "delivered" | "read" | null } | null>(null);
  const left = secondsLeft(card.undoUntil, now);
  const held = card.state === "queued" && card.undoUntil !== null && left > 0 && !undone;

  // the seconds tick only while the hold runs
  React.useEffect(() => {
    if (!held) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [held]);

  // after the hold: ask the outbox where it is, until it is sent and received, failed, or too long
  const watching = !undone && card.messageId !== null && (card.state === "queued" || card.state === "sent") && !held;
  React.useEffect(() => {
    if (!watching || !card.messageId) return;
    let alive = true;
    let n = 0;
    const tick = async () => {
      n++;
      const got = await transport.messageStatus(card.messageId as string);
      if (!alive) return;
      if (got.ok) {
        setSeen({ status: got.status, delivery: got.delivery });
        if (got.status === "failed" || got.status === "blocked" || got.delivery === "read") return;
      }
      if (n < MAX_POLLS) timer = setTimeout(tick, POLL_MS);
    };
    let timer = setTimeout(tick, 600);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [watching, card.messageId, transport]);

  const phase: Phase = undone ? "undone" : card.state === "manual" ? "manual" : card.state === "failed" || seen?.status === "failed" || seen?.status === "blocked" ? "failed" : held ? "held" : card.state === "sent" || seen?.status === "sent" ? "sent" : "queued";
  const delivery = seen?.delivery ?? card.delivery;

  const undo = async () => {
    if (!card.messageId || busy) return;
    setBusy(true);
    setProblem(null);
    const out = await transport.messageUndo(card.messageId);
    setBusy(false);
    if (out.ok) return setUndone(true);
    setProblem(t(out.error === "late" ? "bv.work.msg.err.late" : out.error === "forbidden" ? "bv.chat.err.forbidden" : "bv.work.msg.err.down"));
  };

  const line =
    phase === "held" ? t("bv.work.msg.sending", { name: card.recipient, n: left })
    : phase === "queued" ? t("bv.work.msg.queued", { name: card.recipient })
    : phase === "sent" ? t("bv.work.msg.sent", { name: card.recipient })
    : phase === "failed" ? t("bv.work.msg.failed", { name: card.recipient })
    : phase === "undone" ? t("bv.work.msg.undone", { name: card.recipient })
    : t("bv.work.msg.manual.test");

  return (
    <article data-work="message" data-phase={phase} aria-label={t("bv.work.msg.to", { name: card.recipient })} className={cardBox}>
      <p className="flex items-start gap-2 text-sm font-semibold">
        <MessageCircle className="mt-0.5 size-4 shrink-0 text-brand-text" aria-hidden="true" />
        <span>{t("bv.work.msg.to", { name: card.recipient })}</span>
      </p>
      <blockquote data-work="message-text" className="mt-1.5 rounded-lg border border-line bg-surface-2 px-3 py-2 text-base [overflow-wrap:anywhere] whitespace-pre-wrap">
        {card.text}
      </blockquote>
      <p data-work="message-line" role="status" className={`mt-2 flex flex-wrap items-center gap-x-2 text-sm font-semibold ${phase === "failed" ? "text-red-text" : phase === "sent" ? "text-green-text" : "text-ink"}`}>
        {phase === "sent" ? (delivery === "delivered" || delivery === "read" ? <CheckCheck className="size-4" aria-hidden="true" /> : <Check className="size-4" aria-hidden="true" />) : null}
        <span>{line}</span>
        {phase === "sent" && delivery === "delivered" ? <span className="text-muted">{t("bv.work.msg.delivered")}</span> : null}
        {phase === "sent" && delivery === "read" ? <span className="text-muted">{t("bv.work.msg.read")}</span> : null}
      </p>
      {phase === "held" && card.messageId ? (
        <button type="button" data-work="message-undo" disabled={busy} onClick={() => void undo()} className={`${btnSmall} mt-2`}>
          {t("bv.work.msg.undo")}
        </button>
      ) : null}
      {phase === "manual" && card.messageId && env.base ? (
        <a data-work="message-open" href={`${env.base}/outbox/${card.messageId}/whatsapp`} className={`${btnSmall} mt-2`}>
          {t("bv.work.msg.manual.open")}
        </a>
      ) : null}
      {problem ? (
        <p role="alert" className="mt-1 text-sm font-semibold text-red-text">
          {problem}
        </p>
      ) : null}
    </article>
  );
}
