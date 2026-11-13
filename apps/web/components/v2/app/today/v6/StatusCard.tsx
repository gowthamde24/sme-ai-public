"use client";

import { Pause, Phone, Play } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { NO_FRAME_DATA } from "../../contract";
import { useFrameData } from "../../frame-store";
import { useLiveCalls } from "../../live/live-calls-store";
import { makeT, type Words } from "../../words";
import { clock } from "../../ds/talk/use-talk-live";
import { OrbRing } from "./OrbRing";

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

const btnOutline = "inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-line bg-surface-2 px-3 text-[13px] font-bold text-ink hover:bg-surface";
const btnOrange = "inline-flex min-h-11 flex-1 items-center justify-center rounded-xl border border-brand-edge bg-brand px-3 text-[13px] font-bold text-on-brand hover:brightness-95";

/** A bubble of the card: the assistant's on the left (peach), the customer's on the right (grey). */
function Bubble({ line, faded = false }: { line: CallLine; faded?: boolean }) {
  const mine = line.who === "assistant";
  return (
    <li data-who={line.who} className={`max-w-[88%] px-[11px] py-2 text-[13px] leading-[1.4] ${mine ? "self-start rounded-[12px_12px_12px_4px] bg-brand-bg" : "self-end rounded-[12px_12px_4px_12px] bg-surface-2"} ${faded ? "opacity-50" : ""}`}>
      {line.text}
    </li>
  );
}

/**
 * The status card on the right of Today's band (design system v6, the approved mock). No call: a green dot and "Ready to answer" with the business number (masked: never in full), the orb in its tick ring and "No call right now", the LAST CONVERSATION (two bubbles and a play button),
 * what is next up, today's counts, and Test call / All calls. A call on the line: "Live now" with the clock, the speaking orb, the caller, the last three lines streaming in, who is speaking, Listen · Whisper · Take over, "+N more live" and "Open full call". Listen, Whisper and Play are
 * MOCKS on staging (no sound of a live call reaches the app yet); Take over and Open go to the call's own page, where the existing take-over works.
 */
export function StatusCard({ data, words }: { data: StatusData; words: Words }) {
  const t = makeT(words);
  const frame = useFrameData(NO_FRAME_DATA);
  const shown = useShown(data, frame.live);
  const [listening, setListening] = React.useState(false);
  const [whisper, setWhisper] = React.useState(false);
  const [playing, setPlaying] = React.useState(false);
  const callHref = shown?.id ? `${data.callsHref}/${shown.id}` : data.callsHref;
  const card = "ds-live flex min-w-0 flex-col gap-3 border border-line bg-surface p-4 max-md:hidden";
  if (shown) {
    const last = shown.lines.at(-1);
    return (
      <aside data-part="status-card" data-state="live" aria-label={t("tv6.st.live")} className={card}>
        <div className="flex items-center justify-between gap-2 text-[12.5px] text-muted">
          <span data-status="live" className="!bg-transparent">
            <span aria-hidden="true" className="mr-[7px] inline-block size-2 rounded-full bg-red-text align-[1px] shadow-[0_0_0_4px_var(--ds-glow)]" />
            <b className="text-ink">{t("tv6.st.livenow")}</b>
            {shown.more > 0 ? ` · ${t("tv6.st.calls", { n: shown.more + 1 })}` : ""}
          </span>
          <span className="font-mono tabular-nums">{clock(shown.seconds)}</span>
        </div>
        <div className="flex items-center gap-3">
          <OrbRing size="md" state="speak" />
          <div className="min-w-0">
            <p data-part="caller" className="truncate text-[17px] font-bold">
              {shown.caller || t("tv6.st.unknown")}
            </p>
          </div>
        </div>
        {shown.lines.length > 0 ? (
          <ul data-part="live-lines" aria-live="polite" className="flex flex-col gap-[7px]">
            {shown.lines.map((l, i) => (
              <Bubble key={i} line={l} faded={i === 0 && shown.lines.length >= 3} />
            ))}
          </ul>
        ) : null}
        <p data-part="speaking" className="flex items-center gap-2 text-xs text-muted">
          <span className="ds-bars" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          {last ? (last.who === "customer" ? t("tv6.st.speaking", { name: shown.caller }) : t("tv6.st.assistant_speaking")) : t("tv6.st.on_line")}
        </p>
        <div className="flex gap-2">
          <button type="button" aria-pressed={listening} onClick={() => setListening((v) => !v)} className={btnOutline}>
            {t("tv6.st.listen")}
          </button>
          <button type="button" aria-pressed={whisper} onClick={() => setWhisper((v) => !v)} className={btnOutline}>
            {t("tv6.st.whisper")}
          </button>
          {shown.canTakeOver ? (
            <Link href={callHref} className={btnOrange}>
              {t("tv6.st.takeover")}
            </Link>
          ) : null}
        </div>
        {listening || whisper ? (
          <p role="status" className="text-xs text-muted">
            {t("tv6.st.mock_sound")}
          </p>
        ) : null}
        <div className="flex items-center justify-between gap-2 text-[13px]">
          {shown.more > 0 ? (
            <span data-part="more-live" className="min-w-0 truncate text-muted">
              {t("tv6.st.more", { n: shown.more })}
            </span>
          ) : (
            <span />
          )}
          <Link href={callHref} className="shrink-0 font-bold text-brand-text hover:underline">
            {t("tv6.st.open")}
          </Link>
        </div>
      </aside>
    );
  }
  const c = data.counts;
  const today = [c.waiting !== null ? t("tv6.st.tw", { n: c.waiting }) : null, c.visits !== null ? t("tv6.st.tv", { n: c.visits }) : null, c.enquiries !== null ? t("tv6.st.te", { n: c.enquiries }) : null].filter((x) => x !== null);
  return (
    <aside data-part="status-card" data-state="idle" aria-label={t("tv6.st.ready")} className={card}>
      <div className="flex items-center justify-between gap-2 text-[12.5px] text-muted">
        <span className="min-w-0 truncate">
          <span aria-hidden="true" className="mr-[7px] inline-block size-2 rounded-full bg-green-text align-[1px] shadow-[0_0_0_4px_var(--ds-glow)]" />
          <b className="text-ink">{t("tv6.st.ready")}</b>
        </span>
        {data.number ? (
          <span data-part="masked-number" className="shrink-0 font-mono">
            {data.number}
          </span>
        ) : (
          <Link href={data.phoneHref} data-part="no-number" className="shrink-0 font-semibold text-brand-text hover:underline">
            {t("tv6.st.nonumber")}
          </Link>
        )}
      </div>
      <div className="flex items-center gap-3">
        <OrbRing size="md" state="ambient" />
        <div className="min-w-0">
          <p className="text-[17px] font-bold">{t("tv6.st.nocall")}</p>
          <p className="text-[12.5px] text-muted">{t("tv6.st.nocall.sub")}</p>
        </div>
      </div>
      {data.last ? (
        <div data-part="last-conversation" className="flex flex-col gap-2">
          <p className="truncate text-[11.5px] font-medium uppercase tracking-[0.1em] text-muted">
            {t("tv6.st.last")} · {data.last.who}
          </p>
          <ul className="flex flex-col gap-[7px]">
            {data.last.lines.slice(-2).map((l, i) => (
              <Bubble key={i} line={l} />
            ))}
          </ul>
          <div className="flex items-center gap-2.5">
            <button type="button" aria-pressed={playing} aria-label={t(playing ? "tv6.st.pause" : "tv6.st.play")} onClick={() => setPlaying((v) => !v)} className="inline-flex size-[30px] shrink-0 items-center justify-center rounded-full bg-brand text-on-brand">
              {playing ? <Pause className="size-3.5" aria-hidden="true" /> : <Play className="size-3.5" aria-hidden="true" />}
            </button>
            <span aria-hidden="true" className="h-1 flex-1 rounded-full bg-surface-2" />
          </div>
          {playing ? (
            <p role="status" className="text-xs text-muted">
              {t("tv6.st.mock_sound")}
            </p>
          ) : null}
        </div>
      ) : (
        <div data-part="last-conversation" data-empty="" className="flex flex-col gap-1">
          <p className="text-[11.5px] font-medium uppercase tracking-[0.1em] text-muted">{t("tv6.st.last")}</p>
          <p className="text-sm text-muted">{t("tv6.st.nolast")}</p>
        </div>
      )}
      <div className="flex flex-col text-[13px]">
        <p data-part="next-up" className="flex gap-2.5 border-t border-line py-2">
          <span className="w-[62px] shrink-0 text-muted">{t("tv6.st.next")}</span>
          <span className="min-w-0">{data.nextUp ?? t("tv6.st.nonext")}</span>
        </p>
        {today.length > 0 ? (
          <p data-part="today-counts" className="flex gap-2.5 border-t border-line py-2">
            <span className="w-[62px] shrink-0 text-muted">{t("tv6.st.today")}</span>
            <span className="min-w-0">{today.join(" · ")}</span>
          </p>
        ) : null}
      </div>
      <div className="flex gap-2">
        <Link href={data.testHref} className={btnOutline}>
          <Phone className="size-3.5" aria-hidden="true" />
          {t("tv6.st.test")}
        </Link>
        <Link href={data.callsHref} className={btnOrange}>
          {t("tv6.st.all")}
        </Link>
      </div>
    </aside>
  );
}
