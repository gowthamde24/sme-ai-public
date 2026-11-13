import Link from "next/link";

import type { Conversation } from "@/lib/api/whatsapp";
import { chatHandling, CHAT_FILTERS, filterCounts, inFilter, type ChatFilter, type Handling } from "@/lib/chats/handling";
import { leadTitle } from "@/lib/lead-desk/leads";

import { ago } from "../../today/time";
import { makeT, type Words } from "../../words";

export type ChatListProps = { words: Words; base: string; filter: ChatFilter; chats: readonly Conversation[]; waiting: ReadonlySet<string>; selectedId: string | null; now: number; olderHref: string | null };

const TONE: Record<Handling, string> = {
  reply_ready: "border-brand-edge bg-brand-bg text-brand-text",
  needs_you: "border-amber-text bg-amber-bg text-amber-text",
  assistant: "border-line bg-surface-2 text-muted",
  done: "border-green-text bg-green-bg text-green-text",
};
const chip = "inline-flex min-h-11 items-center gap-2 rounded-full border px-3.5 text-sm font-semibold whitespace-nowrap";

const href = (base: string, filter: ChatFilter, id: string | null) => `${base}/chats${id ? `/${id}` : ""}${filter !== "all" ? `?filter=${filter}` : ""}`;

/**
 * The left column of the Chats page (design system v6): the filters (All · Needs you · By assistant · Done, with their counts) and the chats, newest first. Each row says who handled it: "Reply ready for you", "Answered by assistant", "Needs you", or how it ended
 * ("Visit booked"). A dot marks something new. The customer's number is not shown. Plain links, no script.
 */
export function ChatList({ words, base, filter, chats, waiting, selectedId, now, olderHref }: ChatListProps) {
  const t = makeT(words);
  const rows = chats.map((c) => ({ c, h: chatHandling(c, waiting.has(c.lead_id)) }));
  const counts = filterCounts(rows.map((r) => r.h.state));
  const shown = rows.filter((r) => inFilter(r.h.state, filter));
  return (
    <section className="flex min-w-0 flex-col gap-3" data-chats="list" aria-label={t("chats6.list")}>
      <nav aria-label={t("chats6.filters")} className="flex flex-wrap gap-2" data-part="chat-filters">
        {CHAT_FILTERS.map((f) => (
          <Link key={f} href={href(base, f, selectedId)} aria-current={filter === f ? "true" : undefined} data-filter={f} className={`${chip} ${filter === f ? "border-brand-edge bg-brand-bg text-brand-text" : "border-line bg-surface text-ink hover:bg-surface-2"}`}>
            {t(`chats6.f.${f}`)}
            <span className="tabular-nums text-muted">{counts[f].toLocaleString("en-IN")}</span>
          </Link>
        ))}
      </nav>
      {shown.length === 0 ? (
        <p className="m-0 rounded-2xl border border-line bg-surface p-4 text-sm text-muted" data-part="chats-none">
          {t("chats6.none")}
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {shown.map(({ c, h }) => {
            const name = leadTitle(c.display_name ?? c.name ?? c.company, null, t("wa.chats.customer"));
            const label = h.state === "done" && h.outcome ? (words[`outcome.cat.${h.outcome}`] ?? t("chats6.row.done")) : t(`chats6.row.${h.state}`);
            const open = selectedId === c.lead_id;
            return (
              <li key={c.lead_id}>
                <Link href={href(base, filter, c.lead_id)} aria-current={open ? "true" : undefined} data-unread={c.unread ? "yes" : undefined} data-handling={h.state} className={`flex flex-col gap-1 rounded-2xl border p-3 hover:bg-surface-2 ${open ? "border-brand-edge bg-brand-bg" : "border-line bg-surface"}`}>
                  <span className="flex items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2">
                      {c.unread ? <span className="size-2.5 shrink-0 rounded-full bg-brand" role="img" aria-label={t("wa.chats.new")} /> : null}
                      <span className="truncate font-semibold text-ink">{name}</span>
                    </span>
                    <span className="shrink-0 text-sm text-muted">{ago(c.last_at, now)}</span>
                  </span>
                  <span className="line-clamp-2 text-base text-muted [overflow-wrap:anywhere]">
                    {c.last_direction === "out" ? `${t("wa.chats.you")} ` : ""}
                    {c.preview}
                  </span>
                  <span className="mt-0.5 flex flex-wrap gap-2">
                    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-sm font-semibold ${TONE[h.state]}`} data-part="handled-by">
                      {label}
                    </span>
                    {c.stopped ? <span className="inline-flex items-center rounded-full border border-red-text bg-red-bg px-2.5 py-0.5 text-sm font-semibold text-red-text">{t("wa.chats.stopped")}</span> : null}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {olderHref ? (
        <Link href={olderHref} className="inline-flex min-h-11 items-center self-start text-sm font-semibold text-brand-text underline underline-offset-4">
          {t("wa.chats.older")}
        </Link>
      ) : null}
    </section>
  );
}
