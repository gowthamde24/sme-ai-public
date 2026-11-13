import Link from "next/link";

import type { Conversation } from "@/lib/api/whatsapp";
import { avatarOf, chatTime } from "@/lib/chats/display";
import { chatHandling, CHAT_FILTERS, filterCounts, inFilter, type ChatFilter, type Handling } from "@/lib/chats/handling";
import { leadTitle } from "@/lib/lead-desk/leads";

import { makeT, type Words } from "../../words";

export type ChatListProps = { words: Words; base: string; filter: ChatFilter; q: string; chats: readonly Conversation[]; waiting: ReadonlySet<string>; selectedId: string | null; now: number; olderHref: string | null };

const TONE: Record<Handling, string> = { reply_ready: "text-brand-text", needs_you: "text-red-text", assistant: "text-brand-text", done: "text-green-text" };
const chip = "inline-flex min-h-11 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 text-xs";

const href = (base: string, filter: ChatFilter, q: string, id: string | null) => {
  const p = new URLSearchParams();
  if (filter !== "all") p.set("filter", filter);
  if (q) p.set("q", q);
  const s = p.toString();
  return `${base}/chats${id ? `/${id}` : ""}${s ? `?${s}` : ""}`;
};

/**
 * The left column of the Chats page (approved mock): the filters (All 18 · Needs you 2 · By assistant 14 · Done) in one row, then the chats newest first, each with a coloured avatar, the name, the time ("9:44", "Yesterday", "Mon"), the last words and who handled it: "Reply ready for you"
 * (orange), "Answered by assistant" (orange), "Needs you" (red), or how it ended ("Visit booked", green). The open chat is peach. A dot marks something new. The customer's number is not shown. Plain links, no script.
 */
export function ChatList({ words, base, filter, q, chats, waiting, selectedId, now, olderHref }: ChatListProps) {
  const t = makeT(words);
  const rows = chats.map((c) => ({ c, h: chatHandling(c, waiting.has(c.lead_id)) }));
  const counts = filterCounts(rows.map((r) => r.h.state));
  const shown = rows.filter((r) => inFilter(r.h.state, filter));
  return (
    <section className="flex min-h-0 min-w-0 flex-col" data-chats="list" aria-label={t("chats6.list")}>
      <nav aria-label={t("chats6.filters")} className="flex gap-1.5 overflow-x-auto border-b border-line p-3" data-part="chat-filters">
        {CHAT_FILTERS.map((f) => (
          <Link key={f} href={href(base, f, q, selectedId)} aria-current={filter === f ? "true" : undefined} data-filter={f} className={`${chip} ${filter === f ? "border-ink bg-ink text-bg" : "border-line bg-surface text-ink hover:bg-surface-2"}`}>
            {t(`chats6.f.${f}`)}
            {f !== "done" || counts.done > 0 ? <span className="tabular-nums">{counts[f].toLocaleString("en-IN")}</span> : null}
          </Link>
        ))}
      </nav>
      {shown.length === 0 ? (
        <p className="m-0 p-4 text-sm text-muted" data-part="chats-none">
          {t("chats6.none")}
        </p>
      ) : (
        <ul className="m-0 min-h-0 flex-1 list-none overflow-y-auto p-0">
          {shown.map(({ c, h }) => {
            const name = leadTitle(c.display_name ?? c.name ?? c.company, null, t("wa.chats.customer"));
            const label = h.state === "done" && h.outcome ? (words[`outcome.cat.${h.outcome}`] ?? t("chats6.row.done")) : t(`chats6.row.${h.state}`);
            const open = selectedId === c.lead_id;
            const av = avatarOf(name);
            return (
              <li key={c.lead_id} className="border-b border-line">
                <Link href={href(base, filter, q, c.lead_id)} aria-current={open ? "true" : undefined} data-unread={c.unread ? "yes" : undefined} data-handling={h.state} className={`flex gap-[11px] px-3.5 py-3 hover:bg-surface-2 ${open ? "bg-brand-bg" : ""}`}>
                  <span aria-hidden="true" data-c={av.colour} className="ds-av inline-flex size-10 shrink-0 items-center justify-center rounded-full font-extrabold">
                    {av.letter}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5">
                        {c.unread ? <span className="size-2 shrink-0 rounded-full bg-brand" role="img" aria-label={t("wa.chats.new")} /> : null}
                        <span className="truncate text-sm font-bold text-ink">{name}</span>
                      </span>
                      <span className="shrink-0 text-[11.5px] text-muted">{chatTime(c.last_at, now, t("chats6.yesterday"))}</span>
                    </span>
                    <span className="mt-[3px] block truncate text-[12.5px] text-muted">
                      {c.last_direction === "out" ? `${t("wa.chats.you")} ` : ""}
                      {c.preview}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-x-2">
                      <span className={`text-[11px] font-bold ${TONE[h.state]}`} data-part="handled-by">
                        {label}
                      </span>
                      {c.stopped ? <span className="text-[11px] font-bold text-red-text">{t("wa.chats.stopped")}</span> : null}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {olderHref ? (
        <Link href={olderHref} className="inline-flex min-h-11 items-center self-start px-3.5 text-sm font-semibold text-brand-text underline underline-offset-4">
          {t("wa.chats.older")}
        </Link>
      ) : null}
    </section>
  );
}
