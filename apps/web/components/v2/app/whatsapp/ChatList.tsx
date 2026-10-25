import Link from "next/link";

import { ago } from "../today/time";
import type { ConversationPage } from "@/lib/api/whatsapp";

import { card, h2, pillClass } from "../cc/kit";
import { AgentMark } from "../mark/AgentMark";
import { makeT, type Words } from "../words";

/**
 * Customer chats (job CC, screen 5), the list: the people who have written to the business or been written to on WhatsApp, newest first, each with the last words, how long ago, a dot when there is something new, and a note when the
 * customer asked us to stop or their 24 hours are over. A row opens the chat. The customer's number is not shown anywhere. "Older" follows the API's cursor.
 */
export function ChatList({ tenantId, words, page, now, olderHref }: { tenantId: string; words: Words; page: ConversationPage; now: number; olderHref: string | null }) {
  const t = makeT(words);
  if (page.conversations.length === 0)
    return (
      <section className={`${card} items-start`} data-chats="empty">
        <AgentMark px={64} mood={"resting"} className="size-16" />
        <h2 className={h2}>{t("wa.chats.empty.title")}</h2>
        <p className="text-base text-muted">{t("wa.chats.empty.body")}</p>
      </section>
    );
  return (
    <div className="flex flex-col gap-3" data-chats="list">
      <ul className="flex flex-col gap-3">
        {page.conversations.map((c) => {
          const name = c.name ?? c.company ?? t("wa.chats.customer");
          return (
            <li key={c.lead_id}>
              <Link href={`/app/tenants/${tenantId}/chats/${c.lead_id}`} className={`${card} gap-1 hover:bg-surface-2`} data-unread={c.unread ? "yes" : undefined}>
                <span className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2">
                    {c.unread ? <span className="size-3 shrink-0 rounded-full bg-brand" role="img" aria-label={t("wa.chats.new")} /> : null}
                    <span className="truncate font-display text-lg font-bold">{name}</span>
                  </span>
                  <span className="shrink-0 text-sm text-muted">{ago(c.last_at, now)}</span>
                </span>
                <span className="line-clamp-2 text-base text-muted [overflow-wrap:anywhere]">
                  {c.last_direction === "out" ? `${t("wa.chats.you")} ` : ""}
                  {c.preview}
                </span>
                <span className="mt-1 flex flex-wrap gap-2">
                  {c.stopped ? <span className={pillClass("red")}>{t("wa.chats.stopped")}</span> : null}
                  {!c.stopped && !c.window_open ? <span className={pillClass("amber")}>{t("wa.chats.window_over")}</span> : null}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {olderHref ? (
        <Link href={olderHref} className="inline-flex min-h-11 items-center font-semibold text-brand-text underline">
          {t("wa.chats.older")}
        </Link>
      ) : null}
    </div>
  );
}
