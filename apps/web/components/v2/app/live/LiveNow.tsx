"use client";

import { Check, Inbox, MessageCircle, Phone, FileText } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { groupActivity, type ActivityRow } from "@/lib/activity/types";

import { word, type Labels } from "../labels";
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

/**
 * "Live now" (owner 31 Oct): what the assistant is doing at this moment, in place of the AI usage card. In the menu (`side`, at the bottom) every kind of work is a line that opens the call, chat, quote or lead it is about; on a phone (`line`) it is one slim
 * line under the header (the first thing, and "+n more"), shown under the same rules. Nothing at all is drawn until the first answer (no empty box), and "All caught up" when the assistant is idle. A call's timer counts on from the API's own elapsed
 * seconds. Not asked at all unless the workspace has it switched on (`enabled`).
 */
export function LiveNow({ memberships, labels, enabled, variant, collapsed = false }: { memberships: readonly Membership[]; labels?: Labels; enabled: boolean; variant: "side" | "line"; collapsed?: boolean }) {
  const { current } = useWorkspace(memberships);
  const { feed, at } = useActivity(current?.id ?? null, enabled);
  const rows = React.useMemo(() => (feed ? groupActivity(feed.items) : []), [feed]);
  const hasCall = rows.some((r) => r.key === "call");
  const [now, setNow] = React.useState(0);
  React.useEffect(() => {
    if (!hasCall) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hasCall]);
  if (!current || !enabled || !feed) return null;
  const base = `/app/tenants/${current.id}`;
  const secsOf = (r: ActivityRow) => r.elapsedS + (at > 0 && now > at ? Math.floor((now - at) / 1000) : 0);
  const title = word(labels, "frame.live.title", "Live now");
  const idle = word(labels, "frame.live.idle", "All caught up");
  if (variant === "line") {
    const first = rows[0];
    const text = first ? lineOf(first, secsOf(first), labels) : idle;
    const more = rows.length > 1 ? word(labels, "frame.live.more", "+{n} more", { n: rows.length - 1 }) : null;
    const inner = (
      <>
        {first ? React.createElement(ICON[first.key], { className: "size-4 shrink-0 text-brand-text", "aria-hidden": true }) : <Check className="size-4 shrink-0 text-green-text" aria-hidden="true" />}
        <span className="min-w-0 flex-1 truncate">{text}</span>
        {more ? <span className="shrink-0 text-muted">{more}</span> : null}
      </>
    );
    const cls = "flex min-h-9 items-center gap-2 border-b border-line bg-surface px-4 text-sm font-medium md:hidden print:hidden";
    return first ? (
      <Link href={first.href(base)} data-live="line" role="status" aria-label={`${title}: ${text}`} className={`${cls} hover:bg-surface-2`}>
        {inner}
      </Link>
    ) : (
      <p data-live="line" role="status" aria-label={`${title}: ${text}`} className={`${cls} text-muted`}>
        {inner}
      </p>
    );
  }
  if (collapsed) {
    return (
      <p data-live="side" role="status" title={rows[0] ? lineOf(rows[0], secsOf(rows[0]), labels) : idle} className="flex min-h-9 items-center justify-center text-muted">
        {rows[0] ? React.createElement(ICON[rows[0].key], { className: "size-5 text-brand-text", "aria-hidden": true }) : <Check className="size-5 text-green-text" aria-hidden="true" />}
        <span className="sr-only">{title}: {rows[0] ? lineOf(rows[0], secsOf(rows[0]), labels) : idle}</span>
      </p>
    );
  }
  return (
    <section data-live="side" aria-label={title} className="rounded-lg border border-line bg-surface p-2.5">
      <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
        <span aria-hidden="true" className={`size-2 rounded-full ${rows.length > 0 ? "bg-green-text motion-safe:animate-pulse" : "bg-muted"}`} />
        {title}
      </p>
      {rows.length === 0 ? (
        <p role="status" className="flex items-center gap-2 text-sm font-medium text-muted">
          <Check className="size-4 shrink-0 text-green-text" aria-hidden="true" />
          {idle}
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {rows.slice(0, 4).map((r) => (
            <li key={r.key}>
              <Link href={r.href(base)} className="flex min-h-8 items-center gap-2 rounded-md px-1 text-sm font-medium hover:bg-surface-2">
                {React.createElement(ICON[r.key], { className: "size-4 shrink-0 text-brand-text", "aria-hidden": true })}
                <span className="min-w-0 flex-1 truncate">{lineOf(r, secsOf(r), labels)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
