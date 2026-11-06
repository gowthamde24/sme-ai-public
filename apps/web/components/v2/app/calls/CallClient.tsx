"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { browserAudio } from "@/lib/browser-voice/audio-io";
import type { AudioIO, SocketLike } from "@/lib/browser-voice/client";
import { askVoiceToken } from "@/lib/browser-voice/token";
import { startTakeOver, TAKE_OVER_RATE, type TakeOverState } from "@/lib/calls/take-over";
import { correctionBody } from "@/lib/calls/view";

import { alertBox, btnMain, btnQuiet, fieldHelp, fieldInput, fieldLabel, fieldTextarea, okBox } from "../ui";

type W = Readonly<Record<string, string>>;

/** While a call is live (or the list has one), the page reads itself again every `seconds` (the API's `poll_after_s`), only while the tab is in view. Nothing is drawn. */
export function Repoll({ seconds }: { seconds: number }) {
  const router = useRouter();
  React.useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, Math.max(2, seconds) * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}

/** "End call" (Owner, Admin) with a second yes. The page then shows the call's own state as the API reports it. */
export function EndCall({ w, end }: { w: W; end: () => Promise<{ ok: true } | { ok: false; error: string }> }) {
  const router = useRouter();
  const [sure, setSure] = React.useState(false);
  const [state, setState] = React.useState<"idle" | "sent" | "error">("idle");
  const [busy, start] = React.useTransition();
  if (state === "sent") return <p role="status" className="m-0 text-sm font-semibold text-muted">{w["ph.end.sent"]}</p>;
  return (
    <div className="flex flex-wrap items-center gap-2" data-part="call-end">
      {sure ? (
        <>
          <span className="text-sm text-muted">{w["ph.end.sure"]}</span>
          <button
            type="button"
            disabled={busy}
            className="inline-flex min-h-11 items-center rounded-full bg-ink px-5 font-extrabold text-bg"
            onClick={() =>
              start(async () => {
                const out = await end();
                setState(out.ok ? "sent" : "error");
                setSure(false);
                if (out.ok) router.refresh();
              })
            }
          >
            {w["ph.end.yes"]}
          </button>
          <button type="button" disabled={busy} className={btnQuiet} onClick={() => setSure(false)}>
            {w["ph.end.no"]}
          </button>
        </>
      ) : (
        <button type="button" className="inline-flex min-h-11 items-center rounded-full bg-ink px-5 font-extrabold text-bg" onClick={() => setSure(true)}>
          {w["ph.end"]}
        </button>
      )}
      {state === "error" ? (
        <p role="alert" className={`${alertBox} w-full`}>
          {w["ph.end.err"]}
        </p>
      ) : null}
    </div>
  );
}

type Fields = { summary: string; captured: Record<string, string>; note: string };
export type CorrectFn = (input: { summary?: string; captured?: Record<string, string>; note?: string }) => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>;

/**
 * "Correct it" after a call: the summary in the person's words, what it understood (the same facts, each editable), and a note for next time. Only what changed is sent (an emptied field clears it). The AI's own summary is kept by the
 * API and shown beside the correction; after a save the page reads the call again.
 */
export function CorrectIt({ w, start: given, labels, correct }: { w: W; start: Fields; labels: Readonly<Record<string, string>>; correct: CorrectFn }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [f, setF] = React.useState<Fields>(given);
  const [msg, setMsg] = React.useState<{ ok: true } | { ok: false; error: string } | null>(null);
  const [busy, start] = React.useTransition();
  const keys = Object.keys(given.captured);
  if (!open)
    return (
      <div className="flex flex-col gap-2">
        <button type="button" className={`${btnQuiet} self-start`} onClick={() => (setOpen(true), setMsg(null), setF(given))} data-part="call-correct-open">
          {w["ph.correct"]}
        </button>
        {msg?.ok ? (
          <p role="status" className={okBox}>
            {w["ph.c.saved"]}
          </p>
        ) : null}
      </div>
    );
  const save = () => {
    const body = correctionBody(given, f);
    if (!body) return setMsg({ ok: false, error: "empty" });
    start(async () => {
      const out = await correct(body);
      if (!out.ok) return setMsg(out);
      setMsg({ ok: true });
      setOpen(false);
      router.refresh();
    });
  };
  return (
    <form
      className="flex flex-col gap-3 rounded-2xl border border-line bg-surface-2 p-4"
      data-part="call-correct"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <label className="block">
        <span className={fieldLabel}>{w["ph.c.summary"]}</span>
        <textarea rows={3} maxLength={600} value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} className={fieldTextarea} />
      </label>
      {keys.length ? (
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className={fieldLabel}>{w["ph.c.facts"]}</legend>
          {keys.map((k) => (
            <label key={k} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] items-center gap-2">
              <span className="text-sm text-muted">{labels[k] ?? k}</span>
              <input maxLength={200} value={f.captured[k] ?? ""} onChange={(e) => setF({ ...f, captured: { ...f.captured, [k]: e.target.value } })} className={fieldInput} />
            </label>
          ))}
        </fieldset>
      ) : null}
      <div>
        <label className="block">
          <span className={fieldLabel}>{w["ph.c.note"]}</span>
          <textarea rows={2} maxLength={300} value={f.note} aria-describedby="call-note-help" onChange={(e) => setF({ ...f, note: e.target.value })} className={fieldTextarea} />
        </label>
        <p id="call-note-help" className={fieldHelp}>
          {w["ph.c.note.help"]}
        </p>
      </div>
      {msg && !msg.ok ? (
        <p role="alert" className={alertBox}>
          {w[`ph.c.err.${msg.error}`] ?? w["ph.c.err.down"]}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className={btnMain}>
          {busy ? w["ph.c.saving"] : w["ph.c.save"]}
        </button>
        <button type="button" disabled={busy} className={btnQuiet} onClick={() => (setOpen(false), setMsg(null))}>
          {w["ph.c.cancel"]}
        </button>
      </div>
    </form>
  );
}

const EN_EVENT = "sme:show-english";
const enKey = (userId: string) => `sme.calls.showEnglish.${userId}`;
function readEnglish(userId: string): boolean {
  try {
    return window.localStorage.getItem(enKey(userId)) !== "0";
  } catch {
    return true; // storage blocked: the default, on
  }
}

/**
 * "Show English" on a call (owner, 7 Nov 2026): the English line under each line that is not in English (the API's `text_en`), on by default and remembered for this person on this device. The lines are drawn by the server;
 * this switch only shows or hides them (`data-show-en` on the wrapper; an English line hides itself under `off`). Drawn only when a line has an English version.
 */
export function EnglishLines({ userId, label, has, children }: { userId: string; label: string; has: boolean; children: React.ReactNode }) {
  const on = React.useSyncExternalStore(
    (cb) => {
      window.addEventListener(EN_EVENT, cb);
      window.addEventListener("storage", cb);
      return () => {
        window.removeEventListener(EN_EVENT, cb);
        window.removeEventListener("storage", cb);
      };
    },
    () => readEnglish(userId),
    () => true,
  );
  const flip = () => {
    try {
      window.localStorage.setItem(enKey(userId), on ? "0" : "1");
    } catch {
      // not remembered; the page still switches below
    }
    window.dispatchEvent(new Event(EN_EVENT));
  };
  return (
    <div data-show-en={on ? "on" : "off"} className="flex min-w-0 flex-col gap-3">
      {has ? (
        <button type="button" role="switch" aria-checked={on} onClick={flip} className="inline-flex min-h-11 items-center gap-2 self-end text-sm font-semibold text-ink" data-part="show-english">
          <span aria-hidden="true" className={`relative inline-block h-6 w-10 rounded-full transition-colors ${on ? "bg-[#ff773c]" : "bg-surface-2 shadow-[inset_0_0_0_1.5px_var(--v2-border)]"}`}>
            <span className={`absolute top-1 size-4 rounded-full bg-white shadow transition-[left] ${on ? "left-5" : "left-1"}`} />
          </span>
          {label}
        </button>
      ) : null}
      {children}
    </div>
  );
}

/**
 * "Take over (you talk)" on a live call (app v4 part 4; Owner and Admin): the person's microphone goes to the caller and the caller's voice plays here, while the assistant is quiet; "Hand back to the assistant" gives the call back
 * (lib/calls/take-over.ts has the socket). Shown only where the API has it (the page passes the socket's address). Nothing is recorded. The audio and the socket can be handed in for tests.
 */
export function TakeOver({ w, url, tokenUrl, audioFactory, socketFactory }: { w: W; url: string; tokenUrl: string; audioFactory?: () => AudioIO; socketFactory?: (u: string) => SocketLike }) {
  const [state, setState] = React.useState<TakeOverState>({ phase: "idle", error: null });
  const session = React.useRef<{ handBack: () => void; stop: () => void } | null>(null);
  React.useEffect(() => () => session.current?.stop(), []); // leaving the page gives the call back
  const start = () => {
    session.current = startTakeOver({
      url,
      token: async () => {
        const t = await askVoiceToken(tokenUrl);
        return t.ok ? t.token : null;
      },
      audio: (audioFactory ?? (() => browserAudio(TAKE_OVER_RATE)))(),
      socket: socketFactory ?? ((u) => new WebSocket(u) as unknown as SocketLike),
      onChange: setState,
    });
  };
  const { phase, error } = state;
  if (phase === "connecting" || phase === "on")
    return (
      <div className="flex flex-col items-start gap-2 md:items-end" data-part="take-over" data-phase={phase}>
        <p role="status" className="m-0 text-sm font-semibold text-brand-text">
          {phase === "on" ? w["ph.take.on"] : w["ph.take.connecting"]}
        </p>
        <button type="button" className={btnMain} onClick={() => session.current?.handBack()}>
          {w["ph.take.back"]}
        </button>
        <p className="m-0 text-xs text-muted">{w["ph.take.note"]}</p>
      </div>
    );
  if (phase === "ended")
    return (
      <p role="status" className="m-0 text-sm font-semibold text-muted" data-part="take-over" data-phase="ended">
        {w["ph.take.ended"]}
      </p>
    );
  return (
    <div className="flex flex-col items-start gap-2 md:items-end" data-part="take-over" data-phase={phase}>
      <button type="button" className="inline-flex min-h-11 items-center rounded-full border-2 border-ink px-5 font-extrabold text-ink hover:bg-surface-2" onClick={start}>
        {w["ph.take"]}
      </button>
      {phase === "back" ? (
        <p role="status" className="m-0 text-sm text-muted">
          {w["ph.take.back.done"]}
        </p>
      ) : null}
      {phase === "error" && error ? (
        <p role="alert" className={`${alertBox} m-0`}>
          {w[`ph.take.err.${error}`] ?? w["ph.take.err.down"]}
        </p>
      ) : null}
    </div>
  );
}
