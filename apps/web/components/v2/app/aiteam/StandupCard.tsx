"use client";

import Link from "next/link";
import * as React from "react";

import type { Standup } from "@/lib/api/ai-team";

import { clockOf, fill } from "./shift";

export type RemakeFn = (date: string) => Promise<{ ok: true; standup: Standup } | { ok: false; error: "limit" | "forbidden" | "signin" | "failed" }>;

/**
 * The daily stand-up (Owner and Admin): ▶ Play (the assistant's own voice, fetched through this app's route with the person's token on the server, played from memory), the words below it line by line (made by code from the day's
 * rows, never by a model), a small "draft" mark for words no native speaker has read yet (Kannada for now), "Make it again" (at most 3 a day) and "Ask a follow-up" (the assistant, with the stand-up's date).
 * `compact` is Today's version: the first two lines and a link to My AI team.
 */
export function StandupCard({ base, date, isToday, initial, words, remake, compact = false }: { base: string; date: string; isToday: boolean; initial: Standup | null; words: Readonly<Record<string, string>>; remake: RemakeFn | null; compact?: boolean }) {
  const w = (k: string, vars?: Record<string, string>) => fill(words[k] ?? k, vars);
  const [standup, setStandup] = React.useState(initial);
  const [playing, setPlaying] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [audioFailed, setAudioFailed] = React.useState(false);
  const [making, setMaking] = React.useState(false);
  const [note, setNote] = React.useState<"limit" | "failed" | null>(null);
  const audio = React.useRef<HTMLAudioElement | null>(null);
  const url = React.useRef<string | null>(null);

  React.useEffect(
    () => () => {
      audio.current?.pause();
      if (url.current) URL.revokeObjectURL(url.current);
    },
    [],
  );
  const play = async () => {
    if (playing) {
      audio.current?.pause();
      setPlaying(false);
      return;
    }
    setAudioFailed(false);
    try {
      if (!audio.current) {
        setLoading(true);
        const r = await fetch(`${base}/ai-team/standup-audio?${new URLSearchParams({ date }).toString()}`, { credentials: "same-origin", cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        url.current = URL.createObjectURL(await r.blob());
        audio.current = new Audio(url.current);
        audio.current.onended = () => setPlaying(false);
        setLoading(false);
      }
      await audio.current.play();
      setPlaying(true);
    } catch {
      setLoading(false);
      setPlaying(false);
      setAudioFailed(true);
    }
  };
  const again = async () => {
    if (!remake || making) return;
    setMaking(true);
    setNote(null);
    const r = await remake(date);
    setMaking(false);
    if (r.ok) {
      audio.current?.pause();
      audio.current = null;
      if (url.current) URL.revokeObjectURL(url.current);
      url.current = null;
      setPlaying(false);
      setStandup(r.standup);
    } else setNote(r.error === "limit" ? "limit" : "failed");
  };
  const ask = `${base}/talk?${new URLSearchParams({ ask: fill(words["aiteam.standup.ask.text"] ?? "", { date: `${date.slice(8, 10)}/${date.slice(5, 7)}` }) }).toString()}`;
  const lines = standup ? (compact ? standup.lines.slice(0, 2) : standup.lines) : [];

  return (
    <section aria-labelledby={`standup-${compact ? "today" : "page"}`} data-standup="" className="rounded-xl border border-line bg-surface p-4 shadow-[var(--v2-shadow)] sm:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void play()}
          disabled={!standup?.audio || loading}
          aria-pressed={playing}
          data-part="play"
          className="order-2 inline-flex min-h-12 items-center gap-2 rounded-full bg-brand px-5 sm:order-none text-base font-semibold text-white shadow hover:opacity-90 disabled:opacity-50"
        >
          <span aria-hidden="true">{playing ? "❚❚" : "▶"}</span>
          {playing ? w("aiteam.standup.pause") : isToday ? w("aiteam.standup.play") : w("aiteam.standup.play.day")}
        </button>
        <div className="order-1 min-w-0 basis-full sm:order-none sm:basis-auto sm:flex-1">
          <h2 id={`standup-${compact ? "today" : "page"}`} className="flex flex-wrap items-center gap-2 font-display text-xl font-bold">
            {w("aiteam.standup.title")}
            {standup?.draft ? (
              <span title={w("aiteam.standup.draft.why")} className="rounded-full border border-amber-text bg-amber-bg px-2 py-0.5 text-xs font-semibold text-amber-text" data-part="draft">
                {w("aiteam.standup.draft")}
              </span>
            ) : null}
          </h2>
          {standup ? (
            <p className="text-sm text-muted">
              {w("aiteam.standup.made", { time: clockOf(standup.generatedAt) })}
              {standup.audio ? ` · ${w("aiteam.standup.seconds", { seconds: String(standup.audio.seconds) })}` : ""}
            </p>
          ) : null}
        </div>
      </div>
      {standup && !standup.audio ? <p className="mt-3 text-sm text-muted">{w("aiteam.standup.noaudio")}</p> : null}
      {audioFailed ? (
        <p role="alert" className="mt-3 text-sm text-red-text">
          {w("aiteam.standup.audiofail")}
        </p>
      ) : null}
      {!standup ? <p className="mt-3 text-base text-muted">{isToday ? w("aiteam.standup.none") : w("aiteam.standup.none.past")}</p> : null}
      {lines.length ? (
        <div className="mt-3">
          {compact ? null : <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted">{w("aiteam.standup.transcript")}</h3>}
          <ol className="flex flex-col gap-1.5 text-base" data-part="transcript" lang={standup?.language}>
            {lines.map((l, i) => (
              <li key={i} data-source={l.source}>
                {l.text}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        {compact ? (
          <Link href={`${base}/ai-team`} className="inline-flex min-h-11 items-center font-semibold text-brand-text hover:underline">
            {w("aiteam.standup.open")}
          </Link>
        ) : null}
        {standup ? (
          <Link href={ask} className="inline-flex min-h-11 items-center font-semibold text-brand-text hover:underline" data-part="ask">
            {w("aiteam.standup.ask")}
          </Link>
        ) : null}
        {remake && isToday && !compact ? (
          standup && standup.leftToday <= 0 ? (
            <span className="text-sm text-muted">{w("aiteam.standup.limit")}</span>
          ) : (
            <button type="button" onClick={() => void again()} disabled={making} className="inline-flex min-h-11 items-center rounded-lg px-2 font-semibold text-brand-text hover:underline disabled:opacity-60" data-part="again">
              {making ? w("aiteam.standup.making") : standup ? w("aiteam.standup.again", { left: String(standup.leftToday) }) : w("aiteam.standup.make")}
            </button>
          )
        ) : null}
      </div>
      {note ? (
        <p role="alert" className="mt-2 text-sm text-amber-text">
          {note === "limit" ? w("aiteam.standup.limit") : w("aiteam.standup.failed")}
        </p>
      ) : null}
    </section>
  );
}
