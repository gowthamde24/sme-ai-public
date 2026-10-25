"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { Orb } from "@/components/v2/Orb";

import { btnQuiet } from "../ui";
import { makeT, type Words } from "../words";

export type LiveCallView = { callee: string; kind: string; lang: string; langName: string; startedSecondsAgo: number; caption: string; transcript: readonly { who: "ai" | "customer"; text: string }[] };
const clock = (s: number): string => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

/**
 * The live call screen (job DM, from Call.dc.html): the way back, "Live · 01:12" counting up, the AI circle big in the middle (it speaks while the AI talks), who is on the line, what kind of call and in which language, ONE live caption
 * line (the words being said now, in their own language), a link to the full transcript, and two buttons: "Take over the call" and "End call". Taking over stops the AI and says so; ending says so. The screen draws a call it was given
 * (the page reads it); with no telephony yet that call is a pretend one and the screen says so (`testMode`). The clock counts on the person's device. The words come in as props.
 */
export function LiveCall({ words, call, backHref, testMode }: { words: Words; call: LiveCallView; backHref: string; testMode: boolean }) {
  const t = makeT(words);
  const [seconds, setSeconds] = React.useState(call.startedSecondsAgo);
  const [status, setStatus] = React.useState<"live" | "took_over" | "ended">("live");
  const [showTranscript, setShowTranscript] = React.useState(false);
  React.useEffect(() => {
    if (status === "ended") return;
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [status]);
  const speaking = status === "live";
  return (
    <div data-screen="live-call" data-call-status={status} className="mx-auto flex min-h-[calc(100dvh-8rem)] w-full max-w-md flex-col px-6 pb-8 pt-4">
      <header className="flex items-center justify-between">
        <Link href={backHref} aria-label={t("call.back")} className="inline-flex size-11 items-center justify-center rounded-lg text-ink hover:bg-surface-2">
          <ChevronLeft className="size-6" aria-hidden="true" />
        </Link>
        <span className="text-[13px] font-semibold text-brand-text" aria-live="off">
          {status === "ended" ? t("call.ended.short", { time: clock(seconds) }) : `● ${t("call.live")} · ${clock(seconds)}`}
        </span>
        <span className="w-11" />
      </header>
      {testMode ? (
        <p role="note" className="mt-2 rounded-lg border border-amber-text bg-amber-bg px-3 py-2 text-center text-sm font-medium text-amber-text">
          {t("call.testmode")}
        </p>
      ) : null}
      <section className="flex flex-1 flex-col items-center justify-center gap-7 text-center" aria-label={t("call.title")}>
        <Orb px={168} state={speaking ? "speak" : "still"} halo={speaking} />
        <div className="flex flex-col gap-1.5">
          <h1 className="font-display text-3xl font-extrabold leading-tight">{call.callee}</h1>
          <p className="text-[15px] text-muted">
            {t(`call.kind.${call.kind}` as "call.kind.followup")} · {call.langName}
            {status === "ended" ? null : <span className="font-semibold text-brand-text"> · {status === "live" ? t("call.speaking") : t("call.tookover.short")}</span>}
          </p>
        </div>
        {status === "live" ? (
          <p lang={call.lang} data-part="caption" className="max-w-[300px] text-lg leading-relaxed text-ink/80">
            “{call.caption}”
          </p>
        ) : (
          <p role="status" className="max-w-[300px] text-lg leading-relaxed text-muted">
            {status === "took_over" ? t("call.tookover") : t("call.ended")}
          </p>
        )}
        <button type="button" aria-expanded={showTranscript} onClick={() => setShowTranscript(!showTranscript)} className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-text hover:underline">
          {showTranscript ? t("call.transcript.hide") : t("call.transcript.show")}
        </button>
        {showTranscript ? (
          <ol data-part="transcript" lang={call.lang} className="flex w-full flex-col gap-2 text-left text-base">
            {call.transcript.map((l, i) => (
              <li key={i} className={`rounded-xl px-3 py-2 ${l.who === "ai" ? "self-start bg-surface-2" : "self-end bg-brand-bg"}`}>
                <span className="block text-xs font-semibold text-muted">{t(l.who === "ai" ? "call.ai" : "call.customer")}</span>
                {l.text}
              </li>
            ))}
          </ol>
        ) : null}
      </section>
      <footer className="flex flex-col gap-3">
        {status === "live" ? (
          <button type="button" onClick={() => setStatus("took_over")} className="inline-flex h-14 items-center justify-center rounded-2xl bg-ink px-6 text-base font-semibold text-bg">
            {t("call.takeover")}
          </button>
        ) : null}
        {status !== "ended" ? (
          <button type="button" onClick={() => setStatus("ended")} className={`${btnQuiet} !h-12 !border-0 !bg-transparent !text-brand-text`}>
            {t("call.end")}
          </button>
        ) : (
          <Link href={backHref} className="inline-flex h-14 items-center justify-center rounded-2xl bg-ink px-6 text-base font-semibold text-bg">
            {t("call.back")}
          </Link>
        )}
      </footer>
    </div>
  );
}
