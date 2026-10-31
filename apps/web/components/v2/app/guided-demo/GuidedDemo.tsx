"use client";

import { Pause, Play, X } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { createPortal } from "react-dom";

import { addressOf, STEP_KEYS, type Line, type Sound, type StepKey, type StepResult } from "@/lib/guided-demo/script";

import { makeT, type Words } from "../words";
import { primary, quiet, secondary } from "../visits/styles";

export type GuidedDemoActions = { run: (key: StepKey, run: string, leadId: string | null) => Promise<StepResult> };

/** How long a caption stays before the next step, and how long between two lines of the transcript (ms). */
const READ_MS = 6500;
const LINE_MS = 1800;
/** The part of the screen a step is about: the first of these in the page (else the page's content). */
const AREA = ["main [data-part]", "main section", "main table", "main ul", "main"];

/**
 * The guided demo (owner request 28 Oct): a "Start demo" button in the DEMO workspaces plays a story over the REAL screens, six steps, each with a caption in the person's language, the screen of the step opened and its main part outlined, a transcript that
 * appears line by line (the assistant's real voice sound for the call) and Pause, Back, Next. Each step does its work through the real API as the signed-in person (the action; lib/guided-demo/events.ts) and then opens the screen that shows the result. It
 * lives in the workspace's layout, so it stays while the person's screens change. Made-up data only; nothing is sent.
 */
export default function GuidedDemo({ words, routes, actions }: { words?: Words; routes: Record<StepKey, string>; actions: GuidedDemoActions }) {
  const t = makeT(words);
  const router = useRouter();
  const [step, setStep] = React.useState<number | null>(null); // null = not playing
  const [paused, setPaused] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [skipped, setSkipped] = React.useState(false);
  const [shown, setShown] = React.useState<Line[]>([]);
  const run = React.useRef("");
  const leadId = React.useRef<string | null>(null);
  const timers = React.useRef<number[]>([]);
  const audio = React.useRef<HTMLAudioElement | null>(null);
  const goRef = React.useRef<(index: number) => Promise<void>>(async () => undefined);
  const pausedRef = React.useRef(false);
  const token = React.useRef(0); // a step that was left (Back, Next, Close) must not go on

  React.useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);
  const clear = React.useCallback(() => {
    for (const id of timers.current) window.clearTimeout(id);
    timers.current = [];
    audio.current?.pause();
    audio.current = null;
  }, []);
  React.useEffect(() => clear, [clear]);

  const outline = React.useCallback((on: boolean) => {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("[data-demo-area]"))) {
      el.removeAttribute("data-demo-area");
      el.style.outline = "";
      el.style.outlineOffset = "";
    }
    if (!on) return;
    for (const selector of AREA) {
      const el = document.querySelector<HTMLElement>(selector);
      if (el) {
        el.setAttribute("data-demo-area", "");
        el.style.outline = "3px solid #c2410c";
        el.style.outlineOffset = "4px";
        el.scrollIntoView?.({ block: "center", behavior: "smooth" });
        return;
      }
    }
  }, []);

  const play = (sound: Sound | null) => {
    if (sound === null) return;
    try {
      const bytes = Uint8Array.from(atob(sound.base64), (c) => c.charCodeAt(0));
      const a = new Audio(URL.createObjectURL(new Blob([bytes], { type: sound.mime }))); // blob:, as the page's media rule says
      audio.current = a;
      void a.play().catch(() => undefined);
    } catch {
      /* the words are enough */
    }
  };

  const go = React.useCallback(
    async (index: number) => {
      clear();
      const mine = ++token.current;
      if (index >= STEP_KEYS.length) {
        setStep(STEP_KEYS.length);
        outline(false);
        return;
      }
      const key = STEP_KEYS[index];
      setStep(index);
      setShown([]);
      setFailed(false);
      setSkipped(false);
      setBusy(true);
      const out = await actions.run(key, run.current, leadId.current).catch((): StepResult => ({ ok: false }));
      if (mine !== token.current) return;
      setBusy(false);
      if (!out.ok) setFailed(true);
      else {
        if (out.leadId) leadId.current = out.leadId;
        if (out.note === "skip") setSkipped(true);
        out.lines.forEach((line, n) => timers.current.push(window.setTimeout(() => mine === token.current && setShown((s) => [...s, line]), n * LINE_MS)));
        play(out.sound);
      }
      router.push(addressOf(routes[key], routes.today, leadId.current));
      router.refresh();
      timers.current.push(window.setTimeout(() => mine === token.current && outline(true), 1500));
      const stay = READ_MS + (out.ok ? out.lines.length * LINE_MS : 0);
      timers.current.push(window.setTimeout(() => mine === token.current && !pausedRef.current && void goRef.current(index + 1), stay));
    },
    [actions, clear, outline, router, routes],
  );
  React.useEffect(() => {
    goRef.current = go;
  }, [go]);
  // the slot in the top bar (null on the server and until the page is there)
  const slot = React.useSyncExternalStore(
    () => () => undefined,
    () => document.getElementById("demo-start-slot"),
    () => null,
  );
  const start = () => {
    run.current = crypto.randomUUID();
    leadId.current = null;
    setPaused(false);
    void go(0);
  };
  const close = () => {
    token.current++;
    clear();
    outline(false);
    setStep(null);
    setPaused(false);
    setBusy(false);
  };
  const pause = () => {
    if (!paused) {
      clear(); // the timers of this step; the step is over when the person says "Play"
      setPaused(true);
    } else {
      setPaused(false);
      void go(Math.min(step ?? 0, STEP_KEYS.length - 1) + 1);
    }
  };

  // "Start demo" is a small pill in the top bar (owner review, 1 Nov): nothing floats over the page for it, on a desktop or a phone
  if (step === null)
    return slot
      ? createPortal(
          <button type="button" data-part="guided-demo-start" onClick={start} className="inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-brand-edge bg-brand px-3 text-sm font-semibold text-on-brand hover:brightness-95">
            <Play className="size-3.5" aria-hidden="true" />
            {t("gd.start")}
          </button>,
          slot,
        )
      : null;

  const done = step >= STEP_KEYS.length;
  const key = STEP_KEYS[Math.min(step, STEP_KEYS.length - 1)];
  return (
    <section role="region" aria-label={t("gd.label")} data-part="guided-demo" className="fixed inset-x-3 bottom-20 z-40 flex max-h-[60vh] flex-col gap-2 overflow-y-auto rounded-[20px] border border-line bg-surface p-4 shadow-lg md:inset-x-auto md:bottom-4 md:left-4 md:w-[440px]">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-muted">{done ? t("gd.label") : t("gd.step", { n: String(step + 1), total: String(STEP_KEYS.length) })}</p>
        <button type="button" onClick={close} aria-label={t("gd.close")} title={t("gd.close")} className={`${quiet} !min-h-9 !px-2`}>
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      {done ? (
        <p className="text-base font-semibold">{t("gd.done")}</p>
      ) : (
        <>
          <h2 className="font-display text-lg font-semibold leading-tight">{t(`gd.${key}.t` as "gd.lead.t")}</h2>
          <p className="text-sm">{t(`gd.${key}.d` as "gd.lead.d")}</p>
          {busy ? <p role="status" className="text-sm text-muted">{t("gd.working")}</p> : null}
          {skipped ? <p role="status" className="text-sm text-muted">{t("gd.skip")}</p> : null}
          {failed ? <p role="alert" className="rounded-lg border border-red-text bg-red-bg px-3 py-2 text-sm font-medium text-red-text">{t("gd.fail")}</p> : null}
          {shown.length > 0 ? (
            <ul aria-live="polite" data-part="guided-demo-transcript" className="flex flex-col gap-1.5">
              {shown.map((l, n) => (
                <li key={n} className={`rounded-lg px-3 py-2 text-sm ${l.who === "assistant" ? "bg-surface-2" : "border border-line"}`}>
                  <span className="font-semibold">{l.who === "assistant" ? t("gd.speaker.assistant") : t("gd.speaker.lead")}: </span>
                  {l.text}
                </li>
              ))}
            </ul>
          ) : null}
          {key === "ask" && !busy && !failed && shown.length === 1 && !skipped ? <p className="text-sm text-muted">{t("gd.ask.none")}</p> : null}
        </>
      )}
      <p className="text-xs text-muted">{t("gd.note")}</p>
      <div className="flex flex-wrap items-center gap-2">
        {done ? (
          <button type="button" onClick={start} className={primary}>
            {t("gd.again")}
          </button>
        ) : (
          <>
            <button type="button" onClick={pause} className={secondary} aria-pressed={paused}>
              {paused ? <Play className="size-4" aria-hidden="true" /> : <Pause className="size-4" aria-hidden="true" />}
              {paused ? t("gd.play") : t("gd.pause")}
            </button>
            <button type="button" onClick={() => void go(Math.max(step - 1, 0))} disabled={step === 0 || busy} className={quiet}>
              {t("gd.back")}
            </button>
            <button type="button" onClick={() => void go(step + 1)} disabled={busy} className={primary}>
              {t("gd.next")}
            </button>
          </>
        )}
      </div>
    </section>
  );
}
