"use client";

import { ChevronDown, Eye, FileText, Inbox, MessageCircle, Phone, Send } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { groupActivity, type ActivityRow } from "@/lib/activity/types";

import { word, type Labels } from "../labels";
import { NO_FRAME_DATA } from "../contract";
import { useFrameData } from "../frame-store";
import { useLabels } from "../robust/labels-context";

import { useActivity } from "./activity-poll";

const ICON = { call: Phone, chats: MessageCircle, followups: Send, quote: FileText, leads: Inbox } as const;
const clock = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/**
 * The words of one line. In the pill (`short`) a call is "Calling Ramesh"; in the list it is "On a call with Ramesh · 2:14" (`secs` = how long the first thing has been going on: the timer of a call). The others read the same in both: "Replying on WhatsApp · 3 chats",
 * "Sending 3 follow-ups", "Drafting a quote", "Reading 2 new leads".
 */
export function lineOf(row: ActivityRow, secs: number, labels?: Labels, short = false): string {
  if (row.key === "call") {
    if (short) return row.count > 1 ? word(labels, "frame.live.calling.n", "Calling {n} people", { n: row.count }) : row.who ? word(labels, "frame.live.calling", "Calling {name}", { name: row.who }) : word(labels, "frame.live.calling.noname", "On a call");
    if (row.count > 1) return word(labels, "frame.live.calls", "On {n} calls", { n: row.count });
    return row.who ? word(labels, "frame.live.call", "On a call with {name} · {time}", { name: row.who, time: clock(secs) }) : word(labels, "frame.live.call.noname", "On a call · {time}", { time: clock(secs) });
  }
  if (row.key === "chats") return row.count === 1 ? word(labels, "frame.live.chats.one", "Replying on WhatsApp · 1 chat") : word(labels, "frame.live.chats.other", "Replying on WhatsApp · {n} chats", { n: row.count });
  if (row.key === "followups") return row.count === 1 ? word(labels, "frame.live.followups.one", "Sending a follow-up") : word(labels, "frame.live.followups.other", "Sending {n} follow-ups", { n: row.count });
  if (row.key === "quote") return row.count === 1 ? word(labels, "frame.live.quote.one", "Drafting a quote") : word(labels, "frame.live.quote.other", "Drafting {n} quotes", { n: row.count });
  return row.count === 1 ? word(labels, "frame.live.leads.one", "Reading a new lead") : word(labels, "frame.live.leads.other", "Reading {n} new leads", { n: row.count });
}

/**
 * "Live now" (owner 31 Oct): what the assistant is doing at this moment, a compact pill on the greeting row of Today, right-aligned (under the greeting on a phone): "● Reading 2 new leads ▾", a live dot while something is going on. It opens a list of everything going on now, each line a link to the
 * call, chat, quote or lead it is about; when idle it is a plain grey "Watching for leads" (nothing to open; never a count of what waits for the person: that is Needs you). Nothing is drawn until the first answer (no empty box). A call's timer counts on from the
 * API's own elapsed seconds. Not asked at all unless the workspace has it switched on (`frame.live`).
 */
export function LiveNow({ tenantId }: { tenantId: string }) {
  const labels = useLabels(); // the frame's words (this part lives in the page, on the greeting row, under the frame's labels)
  const enabled = useFrameData(NO_FRAME_DATA).live; // the workspace's own layout brings the real `live` flag in through the frame store (like the plan and the usage)
  const { feed, at } = useActivity(tenantId, enabled);
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
  if (!enabled || !feed) return null;
  const base = `/app/tenants/${tenantId}`;
  const secsOf = (r: ActivityRow) => r.elapsedS + (at > 0 && now > at ? Math.floor((now - at) / 1000) : 0);
  const title = word(labels, "frame.live.title", "Live now");
  const idle = word(labels, "frame.live.idle", "Watching for leads");
  const first = rows[0];
  if (!first) {
    return (
      <p data-live="pill" data-state="idle" role="status" aria-label={`${title}: ${idle}`} className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-edge bg-surface px-3 text-sm font-medium text-muted">
        <Eye className="size-4 shrink-0" aria-hidden="true" />
        <span>{idle}</span>
      </p>
    );
  }
  const text = lineOf(first, secsOf(first), labels, true);
  return (
    <div ref={box} data-live="pill" data-state="active" className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        aria-controls={id}
        aria-label={`${title}: ${text}${rows.length > 1 ? ` ${word(labels, "frame.live.more", "+{n} more", { n: rows.length - 1 })}` : ""}`}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex min-h-10 max-w-full items-center gap-2 rounded-full border border-brand-edge bg-brand-bg px-3 text-sm font-semibold text-ink hover:brightness-95 aria-expanded:bg-surface"
      >
        <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-green-text motion-safe:animate-pulse" />
        <span className="min-w-0 truncate md:max-w-[19rem]">{text}</span>
        <ChevronDown className="size-4 shrink-0 text-muted" aria-hidden="true" />
      </button>
      {open ? (
        <div id={id} role="region" aria-label={title} className="absolute left-0 top-full z-[60] mt-2 w-[min(22rem,calc(100vw-2rem))] md:left-auto md:right-0 rounded-2xl border border-line bg-surface p-2 shadow-[var(--v2-shadow-pop)]">
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
