"use client";

import * as React from "react";

import type { AskConsentResult, AskHow, AskOutcome } from "@/lib/api/ask-consent";

import { btnMain, btnQuiet } from "../ui";
import type { makeT } from "../words";

/**
 * "Ask first" (the owner's decision, 14 Nov 2026): consent is strict for EVERY plan; the people whose consent is unknown are not called. The two ways to bring them in, drawn the same on Today's Needs-you item, on Talk live's plan card and on the typed plan card:
 *   "Ask by WhatsApp"        sends each a short "reply OK" (said honestly: NOT consent until the person agrees; the numbers who could not be asked, and why),
 *   "I confirm they agreed"  first an in-app sentence ("I confirm these 12 people agreed to be called. This is recorded."), then the record.
 * The parent supplies the words `t` (the app language's), `onAsk` (a server action, or a call to this workspace's own route) and what to do with an answer (`onDone`: show the NEW plan card, refresh). Every sentence is the app's (words `dst.af.*`), never the API's.
 */
type Note = { kind: "whatsapp"; result: AskConsentResult } | { kind: "confirmed"; result: AskConsentResult } | { kind: "error"; error: "state" | "nobody" | "forbidden" | "down" };

type T = ReturnType<typeof makeT>;
const REASON_KEY: Record<string, string> = { no_opt_in: "dst.af.r_no_opt_in", template_required: "dst.af.r_template", no_template: "dst.af.r_template", outside_window: "dst.af.r_template" };

export function AskFirstActions({ t, people, channel, onAsk, onDone, compact = false }: { t: T; people: number; channel: "call" | "whatsapp" | "both" | null; onAsk: (how: AskHow) => Promise<AskOutcome>; onDone?: (result: AskConsentResult) => void; compact?: boolean }) {
  const [step, setStep] = React.useState<"idle" | "confirming">("idle");
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<Note | null>(null);
  const ask = async (how: AskHow) => {
    setBusy(true);
    setNote(null);
    let out: AskOutcome;
    try {
      out = await onAsk(how);
    } catch {
      out = { ok: false, error: "down" };
    }
    setBusy(false);
    if (!out.ok) return void setNote({ kind: "error", error: out.error });
    setStep("idle");
    setNote({ kind: how === "whatsapp" ? "whatsapp" : "confirmed", result: out.result });
    onDone?.(out.result);
  };
  const confirmQuestion = t(channel === "call" ? "dst.af.confirm_q_call" : "dst.af.confirm_q_send", { n: people });
  const btn = compact ? `${btnQuiet} min-h-11` : btnQuiet;
  return (
    <div data-part="ask-first" className="mt-1 flex flex-col gap-2">
      {step === "confirming" ? (
        <div data-part="ask-first-confirm" role="group" aria-label={confirmQuestion} className="flex flex-col gap-2">
          <p className="m-0 text-sm font-semibold">{confirmQuestion}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => void ask("owner_confirms")} className={`${btnMain} min-h-11`}>
              {t("dst.af.confirm_yes")}
            </button>
            <button type="button" disabled={busy} onClick={() => setStep("idle")} className={btn}>
              {t("dst.af.back")}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" data-part="ask-wa" disabled={busy} onClick={() => void ask("whatsapp")} className={btn}>
            {t("dst.af.ask_wa")}
          </button>
          <button type="button" data-part="ask-confirm" disabled={busy} onClick={() => setStep("confirming")} className={btn}>
            {t("dst.af.confirm")}
          </button>
        </div>
      )}
      {note ? <NoteLine note={note} t={t} /> : null}
    </div>
  );
}

function NoteLine({ note, t }: { note: Note; t: T }) {
  if (note.kind === "error") {
    return (
      <p role="alert" data-part="ask-first-error" className="m-0 text-sm text-red-text">
        {t(`dst.af.err_${note.error}`)}
      </p>
    );
  }
  const r = note.result;
  if (note.kind === "confirmed") {
    return (
      <p role="status" data-part="ask-first-done" className="m-0 text-sm font-semibold text-green-text">
        {t(r.newAction ? "dst.af.confirmed_plan" : "dst.af.confirmed_task", { n: r.asked })}
      </p>
    );
  }
  const reasons = Object.entries(r.blockedReasons);
  const why = reasons.map(([code, n]) => `${t(REASON_KEY[code] ?? "dst.af.r_other")} (${n})`).join(", ");
  return (
    <div role="status" data-part="ask-first-sent" className="grid gap-1 text-sm">
      <p className="m-0 font-semibold">{(r.queued ?? 0) > 0 ? t("dst.af.wa_sent", { n: r.queued ?? 0 }) : t("dst.af.wa_none")}</p>
      {(r.blocked ?? 0) > 0 ? (
        <p className="m-0 text-muted" data-part="ask-first-blocked">
          {t("dst.af.blocked", { n: r.blocked ?? 0, reasons: why })}
        </p>
      ) : null}
      {r.templateStatus === "none_registered" ? <p className="m-0 text-muted">{t("dst.af.template_none")}</p> : null}
    </div>
  );
}
