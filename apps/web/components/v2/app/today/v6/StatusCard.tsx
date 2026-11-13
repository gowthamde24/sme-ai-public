"use client";

import { Pause, Play } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { Orb } from "@/components/v2/Orb";

import { NO_FRAME_DATA } from "../../contract";
import { useFrameData } from "../../frame-store";
import { useLiveCalls } from "../../live/live-calls-store";
import { StatusPill } from "../../ds/StatusPill";
import { btnQuiet } from "../../ui";
import { makeT, type Words } from "../../words";
import { clock } from "../../ds/talk/use-talk-live";

export type CallLine = { who: "customer" | "assistant"; text: string };
export type StatusData = {
  /** The business number, already masked (`maskNumber`); null = not known: nothing is drawn. */
  number: string | null;
  /** The last conversation: who, and its last two lines; null = none to show. */
  last: { who: string; lines: readonly CallLine[] } | null;
  /** The next thing coming up today ("Ravi Kumar · 5:30 pm"); null = nothing. */
  nextUp: string | null;
  counts: { waiting: number | null; visits: number | null; enquiries: number | null };
  testHref: string;
  callsHref: string;
  /** Where a business number is connected (Phone numbers). */
  phoneHref: string;
  tenantId: string;
  /** Staging demo (CALL_SCREENS=mock and `?live=1`): a made-up live call whose lines stream in. Real calls come from the live-call poll. */
  mock: { caller: string; lines: readonly CallLine[] } | null;
  /** A made-up second live call, to show "+N more live". */
  mockMore?: number;
};

/** One live call, as the card draws it. */
type Shown = { id: string | null; caller: string; seconds: number; lines: readonly CallLine[]; more: number; canTakeOver: boolean };

function useShown(d: StatusData, enabled: boolean): Shown | null {
  const polled = useLiveCalls(d.tenantId, enabled && d.mock === null);
  const [clockNow, setClockNow] = React.useState(() => Date.now());
  const [tick, setTick] = React.useState(0);
  const [revealed, setRevealed] = React.useState(1);
  const live = d.mock !== null || polled.calls.length > 0;
  React.useEffect(() => {
    if (!live) return;
    const id = setInterval(() => {
      setTick((n) => n + 1);
      setClockNow(Date.now());
    }, 1000);
    return () => clearInterval(id);
  }, [live]);
  const mockLines = d.mock?.lines.length ?? 0;
  React.useEffect(() => {
    if (mockLines === 0) return;
    const id = setInterval(() => setRevealed((n) => Math.min(mockLines, n + 1)), 2500);
    return () => clearInterval(id);
  }, [mockLines]);
  if (d.mock) return { id: null, caller: d.mock.caller, seconds: 72 + tick, lines: d.mock.lines.slice(0, revealed).slice(-3), more: d.mockMore ?? 0, canTakeOver: true };
  const first = polled.calls[0];
  if (!first) return null;
  const since = polled.at > 0 ? Math.max(0, Math.floor((clockNow - polled.at) / 1000)) : 0;
  return { id: first.id, caller: first.who, seconds: first.elapsedS + since, lines: [], more: polled.calls.length - 1, canTakeOver: first.canTakeOver };
}

/**
 * The status card on the right of Today's band (design system v6). No call: "Ready to answer", the business number (masked: never in full), the idle circle, the LAST CONVERSATION (its last two lines, with a play button), what is next up and today's counts, and Test call / All calls.
 * A call on the line: the speaking circle, the caller, the last three lines streaming in, who is speaking, Listen · Whisper · Take over, "+N more live" and "Open full call". Listen, Whisper and Play are MOCKS on staging (no sound of a live call reaches the app yet); Take over and
 * Open go to the call's own page, where the existing take-over works.
 */
export function StatusCard({ data, words }: { data: StatusData; words: Words }) {
  const t = makeT(words);
  const frame = useFrameData(NO_FRAME_DATA);
  const shown = useShown(data, frame.live);
  const [listening, setListening] = React.useState(false);
  const [whisper, setWhisper] = React.useState(false);
  const [playing, setPlaying] = React.useState(false);
  const callHref = shown?.id ? `${data.callsHref}/${shown.id}` : data.callsHref;
  if (shown) {
    const last = shown.lines.at(-1);
    return (
      <aside data-part="status-card" data-state="live" aria-label={t("tv6.st.live")} className="flex min-w-0 flex-col gap-3 rounded-2xl border border-line bg-surface p-4 shadow-[var(--v2-shadow)] max-md:hidden">
        <div className="flex items-center gap-3">
          <Orb px={56} state="speak" halo />
          <div className="min-w-0 flex-1">
            <StatusPill status="live">{t("tv6.st.live")}</StatusPill>
            <p data-part="caller" className="mt-1 truncate text-lg font-semibold">
              {shown.caller || t("tv6.st.unknown")}
            </p>
            <p className="font-mono text-sm tabular-nums text-muted">{clock(shown.seconds)}</p>
          </div>
        </div>
        {shown.lines.length > 0 ? (
          <ul data-part="live-lines" aria-live="polite" className="flex flex-col gap-1.5">
            {shown.lines.map((l, i) => (
              <li key={i} data-who={l.who} className={l.who === "customer" ? "text-sm text-muted" : "text-base font-medium"}>
                {l.text}
              </li>
            ))}
          </ul>
        ) : null}
        <p data-part="speaking" className="text-sm font-semibold text-brand-text">
          {last ? (last.who === "customer" ? t("tv6.st.speaking", { name: shown.caller }) : t("tv6.st.assistant_speaking")) : t("tv6.st.on_line")}
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" aria-pressed={listening} onClick={() => setListening((v) => !v)} className={`${btnQuiet} min-h-11 px-3 text-sm`}>
            {t("tv6.st.listen")}
          </button>
          <button type="button" aria-pressed={whisper} onClick={() => setWhisper((v) => !v)} className={`${btnQuiet} min-h-11 px-3 text-sm`}>
            {t("tv6.st.whisper")}
          </button>
          {shown.canTakeOver ? (
            <Link href={callHref} className={`${btnQuiet} min-h-11 px-3 text-sm`}>
              {t("tv6.st.takeover")}
            </Link>
          ) : null}
        </div>
        {listening || whisper ? (
          <p role="status" className="text-xs text-muted">
            {t("tv6.st.mock_sound")}
          </p>
        ) : null}
        {shown.more > 0 ? (
          <p data-part="more-live">
            <StatusPill status="live">{t("tv6.st.more", { n: shown.more })}</StatusPill>
          </p>
        ) : null}
        <Link href={callHref} className="text-sm font-semibold text-brand-text hover:underline">
          {t("tv6.st.open")}
        </Link>
      </aside>
    );
  }
  const c = data.counts;
  const counts = [
    c.waiting !== null ? { k: "waiting", n: c.waiting, label: t("tv6.st.c.waiting") } : null,
    c.visits !== null ? { k: "visits", n: c.visits, label: t("tv6.st.c.visits") } : null,
    c.enquiries !== null ? { k: "enquiries", n: c.enquiries, label: t("tv6.st.c.enquiries") } : null,
  ].filter((x) => x !== null);
  return (
    <aside data-part="status-card" data-state="idle" aria-label={t("tv6.st.ready")} className="flex min-w-0 flex-col gap-3 rounded-2xl border border-line bg-surface p-4 shadow-[var(--v2-shadow)] max-md:hidden">
      <div className="flex items-center gap-3">
        <Orb px={56} state="ambient" />
        <div className="min-w-0">
          <p className="text-lg font-semibold">{t("tv6.st.ready")}</p>
          {data.number ? (
            <p data-part="masked-number" className="font-mono text-sm text-muted">
              {data.number}
            </p>
          ) : (
            <Link href={data.phoneHref} data-part="no-number" className="text-sm font-semibold text-brand-text hover:underline">
              {t("tv6.st.nonumber")}
            </Link>
          )}
        </div>
      </div>
      {data.last ? (
        <div data-part="last-conversation" className="rounded-xl bg-surface-2 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-bold tracking-wider text-muted">{t("tv6.st.last")}</p>
            <button type="button" aria-pressed={playing} aria-label={t(playing ? "tv6.st.pause" : "tv6.st.play")} onClick={() => setPlaying((v) => !v)} className="inline-flex size-11 items-center justify-center rounded-full border border-edge bg-surface hover:bg-bg">
              {playing ? <Pause className="size-4" aria-hidden="true" /> : <Play className="size-4" aria-hidden="true" />}
            </button>
          </div>
          <p className="mt-0.5 text-sm font-semibold">{data.last.who}</p>
          <ul className="mt-1 flex flex-col gap-1">
            {data.last.lines.slice(-2).map((l, i) => (
              <li key={i} className={l.who === "customer" ? "text-sm text-muted" : "text-sm font-medium"}>
                {l.text}
              </li>
            ))}
          </ul>
          {playing ? (
            <p role="status" className="mt-1 text-xs text-muted">
              {t("tv6.st.mock_sound")}
            </p>
          ) : null}
        </div>
      ) : (
        <div data-part="last-conversation" data-empty="" className="rounded-xl bg-surface-2 p-3">
          <p className="text-xs font-bold tracking-wider text-muted">{t("tv6.st.last")}</p>
          <p className="mt-1 text-sm text-muted">{t("tv6.st.nolast")}</p>
        </div>
      )}

      <p data-part="next-up" className="text-sm">
        <span className="font-bold text-muted">{t("tv6.st.next")}</span> {data.nextUp ?? t("tv6.st.nonext")}
      </p>
      {counts.length > 0 ? (
        <dl data-part="today-counts" className="grid grid-cols-3 gap-2 text-center">
          {counts.map((x) => (
            <div key={x.k} className="rounded-lg bg-surface-2 px-1 py-2">
              <dd className="text-xl font-semibold tabular-nums">{x.n}</dd>
              <dt className="text-xs text-muted">{x.label}</dt>
            </div>
          ))}
        </dl>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Link href={data.testHref} className={`${btnQuiet} min-h-11 flex-1 px-3 text-sm`}>
          {t("tv6.st.test")}
        </Link>
        <Link href={data.callsHref} className={`${btnQuiet} min-h-11 flex-1 px-3 text-sm`}>
          {t("tv6.st.all")}
        </Link>
      </div>
    </aside>
  );
}
