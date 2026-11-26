"use client";

import { useState } from "react";

import type { ConsentAskPreview } from "@/lib/api/consent-ask";

type PreviewResult = { ok: true; preview: ConsentAskPreview } | { ok: false; error: string };
type SendResult = { ok: true; replayed: boolean } | { ok: false; error: string };
type Step = { s: "idle" } | { s: "loading" } | { s: "preview"; p: ConsentAskPreview } | { s: "sending"; p: ConsentAskPreview } | { s: "sent" } | { s: "message"; text: string; again: boolean };

/**
 * "Ask for consent" on the customer's page (owner and admin; campaigns S4, C1's contract 18 Nov). Tapping it ONLY shows the exact words that would go and how (nothing is sent); "Send ask" is the owner's own approval and the only thing that sends,
 * through the outbox with its usual rules. A customer who cannot be asked gets a plain sentence and no button. The customer's "OK" is recorded by the owner from Chats, never automatically. `words` are `consent.ask.*`, in the person's language.
 */
export function ConsentAsk({ words, preview, send }: { words: Readonly<Record<string, string>>; preview: () => Promise<PreviewResult>; send: (messageId: string) => Promise<SendResult> }) {
  const [step, setStep] = useState<Step>({ s: "idle" });
  const w = (k: string): string => words[`consent.ask.${k}`] ?? "";
  const err = (e: string): string => w(`err.${e}`) || w("err.down");
  async function open() {
    setStep({ s: "loading" });
    const r = await preview().catch((): PreviewResult => ({ ok: false, error: "down" }));
    if (!r.ok) return setStep({ s: "message", text: err(r.error), again: true });
    const p = r.preview;
    // not needed (agreed, stopped, no WhatsApp number): a plain sentence and no button; the message cannot go yet (no approved template): the sentence, and the button stays
    if (!p.needed || p.how === "none" || !p.text || !p.messageId) return setStep({ s: "message", text: w(`reason.${p.reason ?? "unknown"}`) || w("reason.unknown"), again: p.needed });
    setStep({ s: "preview", p });
  }
  async function go(p: ConsentAskPreview) {
    if (!p.messageId) return;
    setStep({ s: "sending", p });
    const r = await send(p.messageId).catch((): SendResult => ({ ok: false, error: "down" }));
    setStep(r.ok ? { s: "sent" } : { s: "message", text: err(r.error), again: true });
  }
  const busy = step.s === "loading" || step.s === "sending";
  return (
    <div className="mt-1 flex flex-col items-start gap-2" data-part="consent-ask">
      {step.s === "idle" || (step.s === "message" && step.again) ? (
        <button type="button" onClick={() => void open()} className="inline-flex min-h-11 items-center rounded-md border border-line bg-surface px-4 text-sm font-semibold text-brand-text hover:underline">
          {w("button")}
        </button>
      ) : null}
      {step.s === "loading" ? <p role="status" className="m-0 text-sm text-muted">{w("loading")}</p> : null}
      {step.s === "message" ? <p role="status" className="m-0 text-sm text-ink" data-part="consent-ask-note">{step.text}</p> : null}
      {step.s === "sent" ? <p role="status" className="m-0 text-sm text-ink" data-part="consent-ask-sent">{w("sent")}</p> : null}
      {step.s === "preview" || step.s === "sending" ? (
        <div className="flex max-w-xl flex-col gap-2 rounded-xl border border-line bg-surface p-3" data-part="consent-ask-preview">
          <p className="m-0 text-sm text-muted">{w("title").replace("{customer}", step.p.customer ?? "")}</p>
          <p className="m-0 whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-base text-ink [overflow-wrap:anywhere]" data-part="consent-ask-text">{step.p.text}</p>
          <p className="m-0 text-sm text-muted">{w(step.p.how === "template" ? "how.template" : "how.message")}</p>
          <p className="m-0 text-sm text-muted">{w("hint")}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => void go(step.p)} className="inline-flex min-h-11 items-center rounded-md bg-[#ff773c] px-5 font-extrabold text-[#1e1e24] disabled:opacity-60">
              {w("send")}
            </button>
            <button type="button" disabled={busy} onClick={() => setStep({ s: "idle" })} className="inline-flex min-h-11 items-center rounded-md px-4 text-sm font-semibold text-brand-text hover:underline">
              {w("cancel")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
