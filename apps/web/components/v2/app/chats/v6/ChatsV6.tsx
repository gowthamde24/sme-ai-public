import { Search } from "lucide-react";
import type { ReactNode } from "react";

import { EmptyNext } from "@/components/v2/app/ds/EmptyNext";
import { PageHeader } from "@/components/v2/app/ds/PageHeader";
import type { Conversation as ConversationRow } from "@/lib/api/whatsapp";
import type { ChatFilter } from "@/lib/chats/handling";

import { pageMain } from "../../ui";
import { makeT, type Words } from "../../words";
import { ChatList } from "./ChatList";
import { CustomerCard, type CustomerCardProps } from "./CustomerCard";
import { Conversation } from "./Lazy";
import type { ConversationProps } from "./Conversation";

export type ChatsV6Props = {
  words: Words;
  lang: string;
  base: string;
  filter: ChatFilter;
  /** the words in the search box */
  q: string;
  /** the chats the API sent (null: they could not be read) */
  chats: readonly ConversationRow[] | null;
  /** the chats that have a reply of the assistant waiting for the owner's OK */
  waiting: ReadonlySet<string>;
  now: number;
  olderHref: string | null;
  selectedId: string | null;
  /** the chat was chosen by the page, not by the person (a wide screen shows it beside the list; a phone shows the list) */
  defaultOpen?: boolean;
  /** phone: show the customer card instead of the chat */
  card: boolean;
  /** the open chat, or null when it could not be read */
  conversation: Omit<ConversationProps, "words" | "backHref" | "cardHref" | "customerHref" | "source" | "now"> | null;
  customer: Omit<CustomerCardProps, "words" | "base" | "now" | "backHref"> | null;
  help: ReactNode;
  /** the "Connect WhatsApp" address for an empty inbox */
  connectHref: string;
};

/**
 * The Chats page of design system v6 (owner, 13 Nov 2026): three columns, the chats (with who handled each), the conversation (bubbles, the glowing reply that waits for the owner's OK, the composer) and the customer card. On a phone they are three screens in turn: the list, the
 * conversation, the customer card. An inbox with no chats shows its next step. Nothing here sends a message by itself; WhatsApp sending stays mocked on staging.
 */
export function ChatsV6(p: ChatsV6Props) {
  const t = makeT(p.words);
  const open = p.selectedId !== null && p.defaultOpen !== true;
  const listHref = `${p.base}/chats${p.filter !== "all" ? `?filter=${p.filter}` : ""}`;
  const chatHref = p.selectedId ? `${p.base}/chats/${p.selectedId}${p.filter !== "all" ? `?filter=${p.filter}` : ""}` : listHref;
  const cardHref = `${chatHref}${chatHref.includes("?") ? "&" : "?"}card=1`;
  const search = (
    <form action={`${p.base}/chats`} method="get" role="search" className="w-full md:w-[380px]">
      {p.filter !== "all" ? <input type="hidden" name="filter" value={p.filter} /> : null}
      <label className="relative block">
        <span className="sr-only">{t("chats6.search.label")}</span>
        <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <input type="search" name="q" defaultValue={p.q} maxLength={80} placeholder={t("chats6.search.placeholder")} className="min-h-11 w-full rounded-[14px] border border-line bg-surface pl-10 pr-3 text-[14px] text-ink placeholder:text-muted focus:border-brand-edge" />
      </label>
      <button type="submit" className="sr-only">
        {t("chats6.search.go")}
      </button>
    </form>
  );
  const header = <PageHeader title={t("chats6.title")} sub={t("chats6.sub")} right={p.chats !== null && p.chats.length === 0 && !p.q ? null : search} />;
  if (p.chats !== null && p.chats.length === 0 && !open && !p.q)
    return (
      <main className={pageMain} lang={p.lang} data-screen="chats">
        {p.help}
        {header}
        <div className="mt-8">
          <EmptyNext title={t("chats6.empty.title")} text={t("chats6.empty.text")} action={{ href: p.connectHref, label: t("chats6.empty.action") }} help={t("chats6.empty.help")} />
        </div>
      </main>
    );
  return (
    <main className={pageMain} lang={p.lang} data-screen="chats">
      {p.help}
      {header}
      <div className="mt-4 grid grid-cols-[minmax(0,1fr)] overflow-hidden rounded-[18px] border border-line bg-surface shadow-[var(--v2-shadow)] lg:h-[calc(100vh-13rem)] lg:min-h-[560px] lg:grid-cols-[330px_minmax(0,1fr)_300px]">
        <div className={`${open ? "hidden lg:flex" : "flex"} min-h-0 flex-col lg:border-r lg:border-line`}>
          {p.chats === null ? (
            <p role="alert" className="m-0 p-4 text-sm text-muted">
              {t("chats6.unread")}
            </p>
          ) : (
            <ChatList words={p.words} base={p.base} filter={p.filter} q={p.q} chats={p.chats} waiting={p.waiting} selectedId={p.selectedId} now={p.now} olderHref={p.olderHref} />
          )}
        </div>
        <div className={`${open && !p.card ? "flex" : "hidden"} min-h-0 min-w-0 flex-col lg:flex`}>
          {p.conversation ? (
            <Conversation key={`${p.selectedId}:${p.conversation.waiting?.id ?? ""}:${p.conversation.waiting?.text ?? ""}:${p.conversation.assistantOn}`} words={p.words} backHref={listHref} cardHref={cardHref} customerHref={`${p.base}/customers/${p.selectedId}`} source={p.customer?.source ?? null} now={p.now} {...p.conversation} />
          ) : open ? (
            <p role="alert" className="m-0 p-4 text-sm text-muted" data-part="chat-missing">
              {t("chats6.chat.unread")}
            </p>
          ) : (
            <div className="m-4 rounded-2xl border border-dashed border-line p-6 text-center text-base text-muted" data-part="chat-pick">
              {t("chats6.pick")}
            </div>
          )}
        </div>
        <div className={`${open && p.card ? "block" : "hidden"} min-h-0 overflow-y-auto lg:block lg:border-l lg:border-line`}>
          {p.customer ? <CustomerCard words={p.words} base={p.base} now={p.now} backHref={chatHref} {...p.customer} /> : null}
        </div>
      </div>
    </main>
  );
}
