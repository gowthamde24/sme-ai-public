import { ExternalLink } from "lucide-react";
import Link from "next/link";

import type { DecisionResult } from "@/components/v2/app/today/actions-types";
import type { CustomerHead, TimelineItem } from "@/lib/api/customer-timeline";
import { ago } from "../../today/time";
import { makeT, type Words } from "../../words";
import { QuoteOutcome } from "./Lazy";

/** Customer card data that could be read; each part is null when its read failed (the card says so in that part's place and still draws the rest). */
export type CustomerCardProps = {
  words: Words;
  base: string;
  leadId: string;
  name: string;
  head: CustomerHead | null;
  timeline: readonly TimelineItem[] | null;
  /** the source in words (Lead Desk's own word for it), null when unknown */
  source: string | null;
  now: number;
  approve: ((quoteId: string, type: string) => Promise<DecisionResult>) | null;
  /** phone: back to the chat */
  backHref: string;
};

const row = (label: string, value: string | null) => (value ? { label, value } : null);

/**
 * The right column of the Chats page (design system v6): the customer's name, where they came from, what they are interested in, their budget and event (the profile the API already keeps), the open quote with Approve, and a short history of the calls, messages, quotes and
 * visits. It reads the customer's lead and timeline; a read that fails says so in its place. The number is not shown. On a phone it is its own screen, reached from the chat.
 */
export function CustomerCard({ words, base, leadId, name, head, timeline, source, now, approve, backHref }: CustomerCardProps) {
  const t = makeT(words);
  const p = head?.profile ?? null;
  const facts = [row(t("chats6.card.source"), source), row(t("chats6.card.interested"), p?.need ?? null), row(t("chats6.card.quantity"), p?.quantity ?? null), row(t("chats6.card.budget"), p?.budget ?? null), row(t("chats6.card.event"), p?.timeline ?? null)].filter((x): x is { label: string; value: string } => x !== null);
  const quote = timeline?.find((i) => i.kind === "quote" && (i.target.type === "quote" || i.target.type === "material_quote") && /^[0-9a-f-]{36}$/.test(i.target.id));
  const total = quote?.detail.total_paise;
  const history = (timeline ?? []).slice(0, 8);
  return (
    <aside className="flex min-w-0 flex-col gap-4 rounded-2xl border border-line bg-surface p-4 shadow-[var(--v2-shadow)]" data-chat="customer" aria-label={t("chats6.card.title")}>
      <Link href={backHref} className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-text lg:hidden">
        {t("chats6.card.back")}
      </Link>
      <header className="flex items-start justify-between gap-3">
        <h2 className="m-0 min-w-0 font-display text-xl font-semibold [overflow-wrap:anywhere]">{name}</h2>
        <Link href={`${base}/customers/${leadId}`} className="inline-flex min-h-11 shrink-0 items-center gap-1 text-sm font-semibold text-brand-text" data-part="chat-open-customer">
          {t("chats6.card.open")}
          <ExternalLink aria-hidden="true" className="size-4" />
        </Link>
      </header>
      {head === null ? (
        <p className="m-0 text-sm text-muted">{t("chats6.card.unread")}</p>
      ) : facts.length ? (
        <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
          {facts.map((f) => (
            <div key={f.label} className="contents">
              <dt className="text-muted">{f.label}</dt>
              <dd className="m-0 font-semibold text-ink [overflow-wrap:anywhere]">{f.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="m-0 text-sm text-muted">{t("chats6.card.nofacts")}</p>
      )}
      <section aria-labelledby="cc-quote" className="flex flex-col gap-2 rounded-2xl border border-line bg-surface-2 p-3" data-part="chat-quote">
        <h3 id="cc-quote" className="m-0 text-sm font-bold text-muted">
          {t("chats6.card.quote")}
        </h3>
        {quote ? (
          <QuoteOutcome
            words={words}
            base={base}
            quote={{ quoteId: quote.target.id, type: quote.target.type === "material_quote" ? "material_quote" : "quote", state: quote.detail.status === "draft" ? "waiting" : quote.detail.status === "approved" ? "approved" : "other", totalPaise: typeof total === "number" && Number.isInteger(total) && total >= 0 ? total : null }}
            approve={approve}
          />
        ) : (
          <p className="m-0 text-sm text-muted">{timeline === null ? t("chats6.card.unread") : t("chats6.card.noquote")}</p>
        )}
      </section>
      <section aria-labelledby="cc-history" className="flex flex-col gap-2" data-part="chat-history">
        <h3 id="cc-history" className="m-0 text-sm font-bold text-muted">
          {t("chats6.card.history")}
        </h3>
        {timeline === null ? (
          <p className="m-0 text-sm text-muted">{t("chats6.card.unread")}</p>
        ) : history.length === 0 ? (
          <p className="m-0 text-sm text-muted">{t("chats6.card.nohistory")}</p>
        ) : (
          <ol className="m-0 flex list-none flex-col gap-2 border-l border-line p-0 pl-3">
            {history.map((h, i) => (
              <li key={`${h.kind}-${h.at}-${i}`} data-kind={h.kind} className="text-sm">
                <span className="block font-semibold text-ink [overflow-wrap:anywhere]">{h.text}</span>
                <span className="text-muted">
                  {t(`chats6.kind.${h.kind}`)} · {ago(h.at, now)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </aside>
  );
}
