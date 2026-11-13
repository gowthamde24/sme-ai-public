"use client";

import { Captions } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { callClock } from "@/lib/calls/view";
import type { LiveCall } from "@/lib/live-calls/model";

import { usePathname, useSearchParams } from "next/navigation";

import { NO_FRAME_DATA } from "../contract";
import { useFrameData } from "../frame-store";
import { word, type Labels } from "../labels";
import { workspaceOf } from "../nav";
import { isTodayHome } from "../today/ask/ask-chips";
import { askPing, pingPermission, pingSetting, setPing, subscribePing, useCallPing, type PingWords } from "./call-ping";
import { useLiveCalls } from "./live-calls-store";

/**
 * The live-call bar of app v4 (owner 9 Nov 2026, from Main.dc.html .livebar and PhoneToday.dc.html .island): while a call is live, on EVERY page, a dark pill with a pulsing orange dot and a small sound wave. A desktop has it in the top
 * bar: "{assistant} is on a call with {name} · {source}", the clock, "Read along" and (Owner and Admin, a call that has been answered) "Take over"; a tap on the words opens the call. With two or more calls it says "2 calls live" and
 * opens the Calls list. A phone has the pill at the top: "On a call · {name}", the clock and a round headphones button; a tap anywhere on it opens the call. "Listen" in the design is "Read along" here: no sound of a live call reaches the
 * app, only its words. Everything shown is the API's own: no phone number, no made-up source. Reduce motion: the dot and the wave stand still (design/live.css). One poll for all of it (live-calls-store).
 */
/**
 * The design system v6 (owner, 13 Nov 2026): no assistant name anywhere, so the call line says "Your assistant is on a call with {who}"; and on Today the bar is not drawn at all (the band's first line already says it, in red, with the clock and Listen).
 * `ds` = the design system is on; `today` = the page is Today.
 */
function useDesign(): { ds: boolean; today: boolean } {
  const ds = useFrameData(NO_FRAME_DATA).ds === true;
  const pathname = usePathname();
  const tab = useSearchParams()?.get("tab") ?? null;
  const rest = workspaceOf(pathname ?? "")?.rest ?? null;
  return { ds, today: ds && rest !== null && isTodayHome(rest, tab) };
}

const SHOWN = (labels: Labels, key: string, english: string, vars?: Record<string, string | number>) => word(labels, key, english, vars);

/** A call that has been live for more than 10 minutes is not shown (the server leaves it out too; this keeps counting after the answer). */
const MAX_LIVE_S = 600;
function useClock(all: readonly LiveCall[], at: number): { clock: (c: LiveCall) => string; calls: LiveCall[] } {
  const [now, setNow] = React.useState(() => Date.now());
  const since = (c: LiveCall) => c.elapsedS + (at > 0 && now > at ? Math.floor((now - at) / 1000) : 0);
  const calls = all.filter((c) => since(c) <= MAX_LIVE_S);
  const any = calls.length > 0;
  React.useEffect(() => {
    if (!any) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [any]);
  return { clock: (c) => callClock(since(c)), calls };
}

/** The source as a word of the person's language ("IndiaMART"), or null. */
const sourceOf = (labels: Labels, c: LiveCall): string | null => (c.source ? SHOWN(labels, `frame.live.src.${c.source}`, { website: "website", indiamart: "IndiaMART", email: "e-mail", meta: "Meta" }[c.source]) : null);

const hrefOf = (base: string, calls: readonly LiveCall[]): string => (calls.length === 1 ? `${base}/calls/${calls[0].id}` : `${base}/calls`);

const WAVE = (
  <span aria-hidden="true" className="lv-wave">
    <i />
    <i />
    <i />
    <i />
    <i />
  </span>
);

const BTN = "inline-flex min-h-8 shrink-0 items-center rounded-full border px-3 text-[13px] font-extrabold no-underline";

/** The desktop bar (768 px and up), in the top bar. */
export function LiveBar({ tenantId, labels, enabled }: { tenantId: string; labels?: Labels; enabled: boolean }) {
  const { calls: live, at } = useLiveCalls(tenantId, enabled);
  const { clock, calls } = useClock(live, at);
  const { ds, today } = useDesign();
  if (calls.length === 0 || today) return null;
  const base = `/app/tenants/${tenantId}`;
  const one = calls.length === 1 ? calls[0] : null;
  const src = one ? sourceOf(labels, one) : null;
  const ringing = one !== null && !one.answered; // not answered yet: "Calling ...", no clock, nothing to read or take over
  const text = one ? (ringing ? SHOWN(labels, "frame.live.calling", "Calling {name}", { name: one.who || SHOWN(labels, "frame.live.bar.someone", "a caller") }) : (ds ? SHOWN(labels, "frame.live.bar.one.v6", "Your assistant is on a call with {who}", { who: one.who || SHOWN(labels, "frame.live.bar.someone", "a caller") }) : SHOWN(labels, "frame.live.bar.one", "{assistant} is on a call with {who}", { who: one.who || SHOWN(labels, "frame.live.bar.someone", "a caller") }))) : SHOWN(labels, "frame.live.bar.many", "{n} calls live", { n: calls.length });
  return (
    <div data-live-bar="" role="status" aria-live="polite" className="hidden min-w-0 max-w-full items-center gap-2.5 rounded-full bg-[#1e1e24] py-[5px] pl-3.5 pr-[5px] text-[13px] text-[#f9f8f6] shadow-[0_14px_34px_-14px_rgba(194,65,12,.6),0_0_0_1px_rgba(255,119,60,.35)] md:flex">
      <span aria-hidden="true" className="lv-dot" />
      <span className="max-lg:hidden">{WAVE}</span>
      <Link href={hrefOf(base, calls)} className="min-w-0 truncate text-[#d9d6d2] no-underline hover:underline">
        <b className="font-extrabold text-white">{text}</b>
        {src ? ` · ${src}` : ""}
      </Link>
      {one && !ringing ? <span className="shrink-0 font-extrabold tabular-nums text-[#ffb38f]">{clock(one)}</span> : null}
      {one && ringing ? null : one ? (
        <>
          <Link href={hrefOf(base, calls)} className={`${BTN} border-white/25 text-white`} data-part="read">
            {SHOWN(labels, "frame.live.bar.read", "Read along")}
          </Link>
          {one.canTakeOver ? (
            <Link href={hrefOf(base, calls)} className={`${BTN} border-[#ff773c] bg-[#ff773c] text-[#1e1e24]`} data-part="take">
              {SHOWN(labels, "frame.live.bar.take", "Take over")}
            </Link>
          ) : null}
        </>
      ) : (
        <Link href={hrefOf(base, calls)} className={`${BTN} border-[#ff773c] bg-[#ff773c] text-[#1e1e24]`} data-part="open">
          {SHOWN(labels, "frame.live.bar.open", "Open calls")}
        </Link>
      )}
    </div>
  );
}

/** The phone's pill (under 768 px): the first row of the top bar. */
export function LiveIsland({ tenantId, labels, enabled }: { tenantId: string; labels?: Labels; enabled: boolean }) {
  const { calls: live, at } = useLiveCalls(tenantId, enabled);
  const { clock, calls } = useClock(live, at);
  const { today } = useDesign();
  if (calls.length === 0 || today) return null;
  const base = `/app/tenants/${tenantId}`;
  const one = calls.length === 1 ? calls[0] : null;
  const ringing = one !== null && !one.answered;
  const text = one ? (ringing ? SHOWN(labels, "frame.live.calling", "Calling {name}", { name: one.who || SHOWN(labels, "frame.live.bar.someone", "a caller") }) : SHOWN(labels, "frame.live.island", "On a call · {who}", { who: one.who || SHOWN(labels, "frame.live.bar.someone", "a caller") })) : SHOWN(labels, "frame.live.bar.many", "{n} calls live", { n: calls.length });
  return (
    <div className="flex w-full justify-center pt-[max(0.5rem,env(safe-area-inset-top))] md:hidden" data-live-island-row="">
      <Link href={hrefOf(base, calls)} data-live-island="" role="status" aria-live="polite" className="flex max-w-full items-center gap-2 rounded-full bg-[#1e1e24] py-1.5 pl-3 pr-1.5 text-xs font-extrabold text-white no-underline shadow-[0_12px_28px_-12px_rgba(194,65,12,.7),0_0_0_1px_rgba(255,119,60,.35)]">
        <span aria-hidden="true" className="lv-dot" />
        {WAVE}
        <span className="min-w-0 truncate">{text}</span>
        {one && !ringing ? <span className="shrink-0 tabular-nums text-[#ffb38f]">{clock(one)}</span> : null}
        <span role="img" aria-label={SHOWN(labels, "frame.live.bar.read", "Read along")} className="grid size-7 shrink-0 place-items-center rounded-full bg-[#ff773c] text-[#1e1e24]">
          <Captions className="size-4" aria-hidden="true" />
        </span>
      </Link>
    </div>
  );
}

/**
 * The "a call started" notification and its first question (mounted once). The question is a small friendly card, only when a call is live, the person has not answered before and the browser has not been asked: "Yes, tell me" is the tap that
 * lets the browser ask; "Not now" turns it off (Settings > Notifications turns it on again).
 */
export function LivePing({ tenantId, labels, enabled }: { tenantId: string; labels?: Labels; enabled: boolean }) {
  const { calls, at } = useLiveCalls(tenantId, enabled);
  const { ds } = useDesign();
  const base = `/app/tenants/${tenantId}`;
  const words: PingWords = {
    title: SHOWN(labels, "frame.live.aria", "Live call"),
    body: (c) => {
      const src = sourceOf(labels, c);
      const line = !c.answered ? SHOWN(labels, "frame.live.calling", "Calling {name}", { name: c.who || SHOWN(labels, "frame.live.bar.someone", "a caller") }) : c.named ? (ds ? SHOWN(labels, "frame.live.bar.one.v6", "Your assistant is on a call with {who}", { who: c.who }) : SHOWN(labels, "frame.live.bar.one", "{assistant} is on a call with {who}", { who: c.who })) : ds ? SHOWN(labels, "frame.live.ping.anon.v6", "Your assistant is on a call with a new caller") : SHOWN(labels, "frame.live.ping.anon", "{assistant} is on a call with a new caller");
      return src ? `${line} (${src})` : line;
    },
    read: SHOWN(labels, "frame.live.bar.read", "Read along"),
    take: SHOWN(labels, "frame.live.bar.take", "Take over"),
  };
  useCallPing(calls, at, base, words);
  const setting = React.useSyncExternalStore(subscribePing, () => pingSetting() ?? "none", () => "on");
  const permission = React.useSyncExternalStore(subscribePing, pingPermission, () => "denied" as const); // (read again on every draw, so a change made in the browser's own settings shows when the next call starts)
  if (calls.length === 0 || setting !== "none" || permission !== "default") return null;
  return (
    <div role="dialog" aria-label={SHOWN(labels, "frame.live.ask.t", "Get a notification when a call starts?")} data-live-ask="" className="fixed left-1/2 top-20 z-[70] flex w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-3 rounded-2xl border border-line bg-surface p-4 shadow-[var(--v2-shadow-pop)]">
      <div>
        <p className="m-0 font-display text-base font-bold">{SHOWN(labels, "frame.live.ask.t", "Get a notification when a call starts?")}</p>
        <p className="m-0 mt-1 text-sm text-muted">{SHOWN(labels, "frame.live.ask.b", "It says who is calling and where they came from. Never a phone number.")}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void askPing()} className="inline-flex min-h-11 items-center rounded-full bg-brand px-4 text-sm font-semibold text-on-brand" data-part="yes">
          {SHOWN(labels, "frame.live.ask.yes", "Yes, tell me")}
        </button>
        <button type="button" onClick={() => setPing(false)} className="inline-flex min-h-11 items-center rounded-full border border-edge px-4 text-sm font-semibold" data-part="no">
          {SHOWN(labels, "frame.live.ask.no", "Not now")}
        </button>
      </div>
    </div>
  );
}
