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
  conversation: Omit<ConversationProps, "words" | "backHref" | "cardHref"> | null;
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
  const header = <PageHeader title={t("chats6.title")} sub={t("chats6.sub")} />;
  if (p.chats !== null && p.chats.length === 0 && !open)
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
      <div className="mt-5 grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[minmax(260px,320px)_minmax(0,1fr)_minmax(260px,320px)]">
        <div className={open ? "hidden lg:block" : ""}>
          {p.chats === null ? (
            <p role="alert" className="m-0 rounded-2xl border border-line bg-surface p-4 text-sm text-muted">
              {t("chats6.unread")}
            </p>
          ) : (
            <ChatList words={p.words} base={p.base} filter={p.filter} chats={p.chats} waiting={p.waiting} selectedId={p.selectedId} now={p.now} olderHref={p.olderHref} />
          )}
        </div>
        <div className={`${open && !p.card ? "" : "hidden"} lg:block`}>
          {p.conversation ? (
            <Conversation key={`${p.selectedId}:${p.conversation.waiting?.id ?? ""}:${p.conversation.waiting?.text ?? ""}:${p.conversation.assistantOn}`} words={p.words} backHref={listHref} cardHref={cardHref} {...p.conversation} />
          ) : open ? (
            <p role="alert" className="m-0 rounded-2xl border border-line bg-surface p-4 text-sm text-muted" data-part="chat-missing">
              {t("chats6.chat.unread")}
            </p>
          ) : (
            <div className="rounded-2xl border border-dashed border-line bg-surface/60 p-6 text-center text-base text-muted" data-part="chat-pick">
              {t("chats6.pick")}
            </div>
          )}
        </div>
        <div className={`${open && p.card ? "" : "hidden"} lg:block`}>
          {p.customer ? <CustomerCard words={p.words} base={p.base} now={p.now} backHref={chatHref} {...p.customer} /> : null}
        </div>
      </div>
    </main>
  );
}
