import { ExternalLink } from "lucide-react";
import Link from "next/link";

import type { DecisionResult } from "@/components/v2/app/today/actions-types";
import type { CustomerHead, TimelineItem } from "@/lib/api/customer-timeline";
import { chatTime } from "@/lib/chats/display";

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
const h4 = "m-0 mb-1.5 text-[11.5px] font-bold uppercase tracking-[0.08em] text-muted";

/**
 * The right column of the Chats page (approved mock): CUSTOMER (name, where from, interested in, how many, budget, event: the profile the API already keeps, one line each with the value at the right), OPEN QUOTE (the amount with Approve) and HISTORY (the calls, messages, quotes and visits, newest
 * first, each with its time and an orange dot). It reads the customer's lead and timeline; a read that fails says so in its place. The number is not shown. On a phone it is its own screen, reached from the chat.
 */
export function CustomerCard({ words, base, leadId, name, head, timeline, source, now, approve, backHref }: CustomerCardProps) {
  const t = makeT(words);
  const p = head?.profile ?? null;
  const facts = [row(t("chats6.card.name"), name), row(t("chats6.card.source"), source), row(t("chats6.card.interested"), p?.need ?? null), row(t("chats6.card.quantity"), p?.quantity ?? null), row(t("chats6.card.budget"), p?.budget ?? null), row(t("chats6.card.event"), p?.timeline ?? null)].filter((x): x is { label: string; value: string } => x !== null);
  const quote = timeline?.find((i) => i.kind === "quote" && (i.target.type === "quote" || i.target.type === "material_quote") && /^[0-9a-f-]{36}$/.test(i.target.id));
  const total = quote?.detail.total_paise;
  const history = (timeline ?? []).slice(0, 8);
  return (
    <aside className="flex min-w-0 flex-col gap-[18px] p-4 text-[13px]" data-chat="customer" aria-label={t("chats6.card.title")}>
      <Link href={backHref} className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-text lg:hidden">
        {t("chats6.card.back")}
      </Link>
      <section aria-labelledby="cc-customer">
        <h3 id="cc-customer" className={h4}>
          {t("chats6.card.title")}
        </h3>
        {head === null ? (
          <p className="m-0 text-sm text-muted">{t("chats6.card.unread")}</p>
        ) : facts.length > 1 ? (
          <dl className="m-0">
            {facts.map((f) => (
              <div key={f.label} className="flex justify-between gap-3 border-b border-line py-1.5">
                <dt className="text-muted">{f.label}</dt>
                <dd className="m-0 text-right text-ink [overflow-wrap:anywhere]">{f.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="m-0 text-sm text-muted">{t("chats6.card.nofacts")}</p>
        )}
        <Link href={`${base}/customers/${leadId}`} className="mt-2 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-brand-text" data-part="chat-open-customer">
          {t("chats6.card.open")}
          <ExternalLink aria-hidden="true" className="size-3.5" />
        </Link>
      </section>
      <section aria-labelledby="cc-quote" data-part="chat-quote">
        <h3 id="cc-quote" className={h4}>
          {t("chats6.card.quote")}
        </h3>
        {quote ? (
          <QuoteOutcome
            words={words}
            base={base}
            variant="chat"
            sub={quote.text}
            quote={{ quoteId: quote.target.id, type: quote.target.type === "material_quote" ? "material_quote" : "quote", state: quote.detail.status === "draft" ? "waiting" : quote.detail.status === "approved" ? "approved" : "other", totalPaise: typeof total === "number" && Number.isInteger(total) && total >= 0 ? total : null }}
            approve={approve}
          />
        ) : (
          <p className="m-0 text-sm text-muted">{timeline === null ? t("chats6.card.unread") : t("chats6.card.noquote")}</p>
        )}
      </section>
      <section aria-labelledby="cc-history" data-part="chat-history">
        <h3 id="cc-history" className={h4}>
          {t("chats6.card.history")}
        </h3>
        {timeline === null ? (
          <p className="m-0 text-sm text-muted">{t("chats6.card.unread")}</p>
        ) : history.length === 0 ? (
          <p className="m-0 text-sm text-muted">{t("chats6.card.nohistory")}</p>
        ) : (
          <ol className="m-0 list-none p-0">
            {history.map((h, i) => (
              <li key={`${h.kind}-${h.at}-${i}`} data-kind={h.kind} className="flex gap-2.5 py-1.5">
                <i aria-hidden="true" className="mt-[5px] size-2 shrink-0 rounded-full bg-brand not-italic" />
                <span className="[overflow-wrap:anywhere]">
                  <span className="text-muted">{chatTime(h.at, now, t("chats6.yesterday"))} · </span>
                  <span className="sr-only">{t(`chats6.kind.${h.kind}`)}: </span>
                  {h.text}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </aside>
  );
}
