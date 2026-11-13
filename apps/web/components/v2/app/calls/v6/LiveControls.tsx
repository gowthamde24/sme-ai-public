"use client";

import * as React from "react";

import { EndCall, TakeOver } from "../CallClient";
import { btnMain, btnQuiet, fieldInput } from "../../ui";
import { makeT, type Words } from "../../words";

export type LiveControlsProps = {
  words: Words;
  /** Whisper (Owner, Admin): the server action; null = not drawn */
  whisper: ((text: string) => Promise<{ ok: true } | { ok: false; error: string }>) | null;
  /** End call (Owner, Admin) */
  end: (() => Promise<{ ok: true } | { ok: false; error: string }>) | null;
  /** Take over (Owner, Admin, only where the API says this call can be taken over) */
  takeOver: { url: string; tokenUrl: string } | null;
  ringing: boolean;
};

/**
 * The live panel's controls (design system v6): Listen (a sample on staging: the API cannot stream a call to the app), Whisper (real: C1's `POST /calls/{id}/whisper`, only the assistant hears it), Take over (the existing take-over with the microphone, only where the API says it works for this call)
 * and End (the existing End call with its second yes). Every part is the one the call page already has, so what is said, checked and audited is the same.
 */
export function LiveControls({ words, whisper, end, takeOver, ringing }: LiveControlsProps) {
  const t = makeT(words);
  const [listen, setListen] = React.useState(false);
  const [text, setText] = React.useState("");
  const [sent, setSent] = React.useState<"idle" | "ok" | "err">("idle");
  const [busy, start] = React.useTransition();
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface-2 p-4" data-part="live-controls" aria-label={t("calls6.live.controls")}>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" aria-pressed={listen} onClick={() => setListen((l) => !l)} className={`${btnQuiet} aria-pressed:border-brand-edge aria-pressed:bg-brand-bg aria-pressed:text-brand-text`}>
          {listen ? t("calls6.live.listening") : t("calls6.live.listen")}
        </button>
        {takeOver ? <TakeOver w={words} url={takeOver.url} tokenUrl={takeOver.tokenUrl} /> : null}
        {end ? <EndCall w={words} end={end} ringing={ringing} /> : null}
      </div>
      {listen ? (
        <p role="status" className="m-0 text-sm text-muted">
          {t("calls6.live.listen.note")}
        </p>
      ) : null}
      {whisper ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const words = text.trim();
            if (!words) return;
            start(async () => {
              const r = await whisper(words).catch(() => ({ ok: false as const, error: "down" }));
              setSent(r.ok ? "ok" : "err");
              if (r.ok) setText("");
            });
          }}
        >
          <label htmlFor="whisper-text" className="text-sm font-semibold">
            {t("calls6.whisper.label")}
          </label>
          <div className="flex gap-2">
            <input id="whisper-text" value={text} maxLength={300} onChange={(e) => (setText(e.target.value), setSent("idle"))} placeholder={t("calls6.whisper.placeholder")} className={fieldInput} />
            <button type="submit" disabled={busy || text.trim() === ""} className={btnMain}>
              {t("calls6.whisper.send")}
            </button>
          </div>
          {sent === "ok" ? (
            <p role="status" className="m-0 text-sm font-medium text-green-text">
              {t("calls6.whisper.sent")}
            </p>
          ) : null}
          {sent === "err" ? (
            <p role="alert" className="m-0 text-sm font-medium text-red-text">
              {t("calls6.whisper.err")}
            </p>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}
