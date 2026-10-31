"use client";

import { Check, ChevronDown, FileText, Inbox, MessageCircle, Phone } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { groupActivity, type ActivityRow } from "@/lib/activity/types";

import { word, type Labels } from "../labels";
import type { FrameData } from "../contract";
import { useFrameData } from "../frame-store";
import { useWorkspace, type Membership } from "../use-workspace";
import { useActivity } from "./activity-poll";

const ICON = { call: Phone, chats: MessageCircle, quote: FileText, leads: Inbox } as const;
const clock = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** The words of one line: "On a call with Ramesh · 2:14", "Replying on WhatsApp · 3 chats", "Drafting a quote", "Reading 2 new leads". `secs` = how long the first thing has been going on (the timer of a call). */
export function lineOf(row: ActivityRow, secs: number, labels?: Labels): string {
  if (row.key === "call") {
    if (row.count > 1) return word(labels, "frame.live.calls", "On {n} calls", { n: row.count });
    return row.who ? word(labels, "frame.live.call", "On a call with {name} · {time}", { name: row.who, time: clock(secs) }) : word(labels, "frame.live.call.noname", "On a call · {time}", { time: clock(secs) });
  }
  if (row.key === "chats") return row.count === 1 ? word(labels, "frame.live.chats.one", "Replying on WhatsApp · 1 chat") : word(labels, "frame.live.chats.other", "Replying on WhatsApp · {n} chats", { n: row.count });
  if (row.key === "quote") return row.count === 1 ? word(labels, "frame.live.quote.one", "Drafting a quote") : word(labels, "frame.live.quote.other", "Drafting {n} quotes", { n: row.count });
  return row.count === 1 ? word(labels, "frame.live.leads.one", "Reading a new lead") : word(labels, "frame.live.leads.other", "Reading {n} new leads", { n: row.count });
}

/** The few words of one line for a phone's header: "On a call", "WhatsApp · 3", "Quote", "Leads · 2". */
export function shortOf(row: ActivityRow, labels?: Labels): string {
  if (row.key === "call") return word(labels, "frame.live.short.call", "On a call");
  if (row.key === "chats") return word(labels, "frame.live.short.chats", "WhatsApp · {n}", { n: row.count });
  if (row.key === "quote") return word(labels, "frame.live.short.quote", "Quote");
  return word(labels, "frame.live.short.leads", "Leads · {n}", { n: row.count });
}

/**
 * "Live now" (owner 31 Oct): what the assistant is doing at this moment, a compact pill in the top bar before the bell ("● Reading 2 new leads ▾", a live dot while something is going on). It opens a list of everything going on now, each line a link to the
 * call, chat, quote or lead it is about; when idle it is a plain grey "✓ All caught up" (nothing to open). On a phone the pill is the dot and a short label ("Leads · 2"). Nothing is drawn until the first answer (no empty box). A call's timer counts on from the
 * API's own elapsed seconds. Not asked at all unless the workspace has it switched on (`frame.live`).
 */
export function LiveNow({ memberships, labels, frame: given }: { memberships: readonly Membership[]; labels?: Labels; /** What the frame was given; the workspace's own layout brings the real `live` flag in through the frame store (like the plan and the usage). */ frame: FrameData }) {
  const { current } = useWorkspace(memberships);
  const enabled = useFrameData(given).live;
  const { feed, at } = useActivity(current?.id ?? null, enabled);
  const rows = React.useMemo(() => (feed ? groupActivity(feed.items) : []), [feed]);
  const hasCall = rows.some((r) => r.key === "call");
  const [now, setNow] = React.useState(0);
  const [open, setOpen] = React.useState(false);
  const id = React.useId();
  const box = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!hasCall) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [hasCall]);
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);
  if (!current || !enabled || !feed) return null;
  const base = `/app/tenants/${current.id}`;
  const secsOf = (r: ActivityRow) => r.elapsedS + (at > 0 && now > at ? Math.floor((now - at) / 1000) : 0);
  const title = word(labels, "frame.live.title", "Live now");
  const idle = word(labels, "frame.live.idle", "All caught up");
  const first = rows[0];
  if (!first) {
    return (
      <p data-live="pill" data-state="idle" role="status" aria-label={`${title}: ${idle}`} className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-edge bg-surface px-3 text-sm font-medium text-muted">
        <Check className="size-4 shrink-0 text-green-text" aria-hidden="true" />
        <span className="max-md:hidden">{idle}</span>
        <span className="md:hidden">{word(labels, "frame.live.short.idle", "Caught up")}</span>
      </p>
    );
  }
  const text = lineOf(first, secsOf(first), labels);
  return (
    <div ref={box} data-live="pill" data-state="active" className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        aria-controls={id}
        aria-label={`${title}: ${text}${rows.length > 1 ? ` ${word(labels, "frame.live.more", "+{n} more", { n: rows.length - 1 })}` : ""}`}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex min-h-11 items-center gap-2 rounded-full border border-brand-edge bg-brand-bg px-3 text-sm font-semibold text-ink hover:brightness-95 aria-expanded:bg-surface"
      >
        <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-green-text motion-safe:animate-pulse" />
        <span className="max-w-[17rem] truncate max-md:hidden">{text}</span>
        <span className="max-w-[5.5rem] truncate md:hidden">{shortOf(first, labels)}</span>
        <ChevronDown className="size-4 shrink-0 text-muted max-md:hidden" aria-hidden="true" />
      </button>
      {open ? (
        <div id={id} role="region" aria-label={title} className="absolute right-0 top-full z-[60] mt-2 w-[min(22rem,calc(100vw-1.5rem))] rounded-2xl border border-line bg-surface p-2 shadow-[var(--v2-shadow-pop)]">
          <p className="flex items-center gap-1.5 px-2 pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-muted">
            <span aria-hidden="true" className="size-2 rounded-full bg-green-text motion-safe:animate-pulse" />
            {title}
          </p>
          <ul className="flex flex-col">
            {rows.map((r) => (
              <li key={r.key}>
                <Link href={r.href(base)} onClick={() => setOpen(false)} className="flex min-h-10 items-start gap-2 rounded-lg px-2 py-2 text-sm font-medium hover:bg-surface-2">
                  {React.createElement(ICON[r.key], { className: "mt-0.5 size-4 shrink-0 text-brand-text", "aria-hidden": true })}
                  <span className="min-w-0 flex-1 leading-snug">{lineOf(r, secsOf(r), labels)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
