import Link from "next/link";

import { formatRupees, isManual, type Quote, type QuoteSetup, type QuoteSummary, type QuoteText } from "@/lib/api/quotes";

import type { Order } from "@/lib/api/orders";

import { startOrderAction } from "../orders/order-actions";
import { StartOrderForm } from "../orders/start-order-form";
import {
  approveQuoteAction,
  createQuoteAction,
  pickProductAction,
  rejectQuoteAction,
  withdrawQuoteAction,
} from "./quote-actions";
import { CopyText } from "./copy-text";
import { CreateQuoteForm } from "./create-quote-form";
import { PickLineForm } from "./pick-line-form";
import { QuoteDecisions } from "./quote-decisions";
import { createManualQuoteAction } from "./manual-quote-actions";
import { ManualQuoteForm, type GstInForce } from "./manual-quote-form";
import { QuoteView } from "./quote-view";
import type { ItemType } from "@/lib/api/item-types";
import { WhatsappActions, type SentOnWhatsapp } from "./whatsapp-actions";
import type { WhatsappView } from "./whatsapp-view";
import { alertBox, bigText, bulletList, hintInline, link, listPlain, mutedText, noteBox, pageH2, pageH3, plainText } from "@/components/v2/app/ui";
import { labelOr, makeT, type Words } from "@/components/v2/app/words";

type Props = {
  tenantId: string;
  enquiryId: string;
  role: string;
  secondFactorMissing: boolean;
  setup: QuoteSetup;
  quotes: QuoteSummary[];
  selected: Quote | null;
  text: QuoteText | null;
  textError: string | null;
  newQuoteId: string;
  /** The order already started from the selected quote, if any, and the id a new one would use (the page makes it, so a retry replays). */
  order?: Order | null;
  newOrderId?: string;
  /** The WhatsApp controls of the selected approved quote (null: none are shown). Closed words and ids only: no number, no text. */
  whatsapp?: WhatsappView | null;
  /** "I sent it on WhatsApp": the bound server action and the id the page made for this render (null: no button). */
  sentOnWhatsapp?: SentOnWhatsapp | null;
  /** The "Quote with typed prices" form (owner and admin only; the page passes null for everyone else). `unavailable`: the item types or the policy could not be read. */
  manual?: ManualQuoteData | null;
  /** Which part of the screen to draw: making a quote, the quote made (its figures and decisions), or what comes after approval (the text for the customer, WhatsApp, the order). Left out: all of it, as always. */
  part?: "make" | "view" | "send"; words?: Words;
};

export type ManualQuoteData = { unavailable: false; itemTypes: ItemType[]; gst: GstInForce | null; newQuoteId: string } | { unavailable: true };

/**
 * The quote of one enquiry: a person chooses the product for each approved requirement line (the assistant only suggests), makes a DRAFT, and an owner
 * or admin approves it. After approval the customer-facing text is shown to COPY. This application never sends anything, and the screen says so.
 */
export function QuotePanel({ tenantId, enquiryId, role, secondFactorMissing, setup, quotes, selected, text, textError, newQuoteId, order = null, newOrderId, whatsapp = null, sentOnWhatsapp = null, manual = null, part, words }: Props) {
  const t = makeT(words);
  const showIntro = part !== "send";
  const showMake = part === undefined || part === "make";
  const showView = part === undefined || part === "view";
  const showSend = part === undefined || part === "send";
  const confirmed = setup.requirement_status === "confirmed";
  const blockers = setup.missing.filter((m) => m !== "mapper_unavailable");
  const notes = setup.missing.filter((m) => m === "mapper_unavailable");
  const quotable = setup.lines.filter((l) => l.quotable);
  const unquotable = setup.lines.filter((l) => !l.quotable);
  const allPicked = quotable.length > 0 && quotable.every((l) => l.pick !== null);
  const ready = confirmed && blockers.length === 0;
  const stateName = (code: string) => setup.delivery_states[code] ?? code;
  const base = `/app/tenants/${tenantId}/enquiries/${enquiryId}`;
  // typed prices exist on this screen: the sentence about where prices come from must say so (a list-only screen keeps its sentence)
  const typedPrices = manual !== null || (selected !== null && isManual(selected)) || quotes.some((q) => isManual(q));
  // an enquiry that has quotes, all with typed prices, is not on the list flow: the list notices ("no price list in force", "approve the requirement") are not about it
  const typedOnly = quotes.length > 0 && quotes.every((q) => isManual(q));
  return (
    <section aria-labelledby="quote-heading">
      {showIntro ? (
        <>
        <h2 id="quote-heading" className={pageH2}>
          {t("enq.quote")}
        </h2>
        <p className={mutedText}>
          {t("enq.quote_draft_a")} {typedPrices ? t("enq.prices_typed") : t("enq.prices_list")} {t("enq.nothing_sent_page")}
        </p>

        {(typedOnly || !showMake ? [] : [...blockers, ...notes]).map((m) => (
          <p key={m} role="note" className={noteBox}>
            {labelOr(t, `enq.missing.${m}`, "enq.missing.other")}
          </p>
        ))}

        </>
      ) : (
        <>
          <h2 id="quote-heading" className={pageH2}>
            {t("enq.copy_and_order")}
          </h2>
          <p className={mutedText}>{t("enq.nothing_on_this_page_is_ever")}</p>
        </>
      )}

      {showMake && ready ? (
        <div>
          <h3 className={pageH3}>{t("enq.1_choose_the_product_for_each")}</h3>
          <p className={mutedText}>{t("enq.the_assistant_suggests_products_nothing_is")}</p>
          {quotable.length === 0 ? <p className={bigText}>{t("enq.no_line_has_a_saree_type")}</p> : null}
          {quotable.map((line) => (
            <PickLineForm words={words} key={`${line.line_no}-${line.pick?.product_id ?? "none"}-${line.pick?.qty ?? 0}`} pick={pickProductAction.bind(null, tenantId, enquiryId, line.line_no)} line={line} priceList={setup.price_list} />
          ))}
          {unquotable.length > 0 ? (
            <div role="note" className={noteBox}>
              <strong>{t("enq.not_quoted")}</strong> {t("enq.approve_first")}
              <ul className={bulletList}>
                {unquotable.map((line) => (
                  <li key={line.line_no} className={plainText}>
                    {t("enq.line_n", { n: line.line_no })}: {line.summary.join("; ")}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <h3 className={pageH3}>{t("enq.2_make_a_draft_quote")}</h3>
          {allPicked ? (
            <CreateQuoteForm words={words} create={createQuoteAction.bind(null, tenantId, enquiryId)} quoteId={newQuoteId} states={setup.delivery_states} />
          ) : (
            <p className={mutedText}>{t("enq.choose_a_product_for_every_line")}</p>
          )}
          {quotes.some((q) => q.outcome === "draft") ? <p className={mutedText}>{t("enq.making_a_new_draft_replaces_the")}</p> : null}
        </div>
      ) : null}

      {showMake && manual ? (
        <div>
          {ready ? <p className={mutedText}>{t("enq.or_make_a_quote_with_typed")}</p> : null}
          {manual.unavailable ? (
            <p role="alert" className={alertBox}>
              {t("enq.the_item_types_or_the_quote")}
            </p>
          ) : (
            <>
              <ManualQuoteForm words={words} create={createManualQuoteAction.bind(null, tenantId, enquiryId)} quoteId={manual.newQuoteId} itemTypes={manual.itemTypes} gst={manual.gst} />
              {quotes.some((q) => q.outcome === "draft") ? <p className={mutedText}>{t("enq.making_a_new_draft_replaces_the")}</p> : null}
            </>
          )}
        </div>
      ) : null}

      {selected ? (
        <div>
          {showView ? <QuoteView words={words} quote={selected} stateName={selected.delivery_state === null ? "" : stateName(selected.delivery_state)} /> : null}
          {showView ? <QuoteDecisions words={words}
            approve={approveQuoteAction.bind(null, tenantId, enquiryId, selected.id)}
            reject={rejectQuoteAction.bind(null, tenantId, enquiryId, selected.id)}
            withdraw={withdrawQuoteAction.bind(null, tenantId, enquiryId, selected.id)}
            outcome={selected.outcome}
            role={role}
            needsOwnerApproval={selected.needs_owner_approval}
            secondFactorMissing={secondFactorMissing}
          /> : null}
          {showSend && selected.outcome === "approved" ? (
            <div>
              <h3 className={pageH3}>{t("enq.text_for_the_customer")}</h3>
              {text ? (
                <>
                  <CopyText words={words} text={text.text} />
                  {whatsapp ? <WhatsappActions words={words} tenantId={tenantId} quoteId={selected.id} view={whatsapp} sent={sentOnWhatsapp} /> : null}
                </>
              ) : (
                <p role="alert" className={alertBox}>
                  {t("enq.text_failed", { why: textError ?? t("enq.unavailable") })}
                </p>
              )}
            </div>
          ) : null}
          {showSend && selected.outcome === "approved" && newOrderId ? (
            <div>
              <h3 className={pageH3}>{t("enq.order")}</h3>
              {order ? (
                <p>
                  <Link href={`/app/tenants/${tenantId}/orders/${order.id}`} className={link}>
                    {t("enq.order_n_link", { n: order.order_no })}
                  </Link>{" "}
                  <span className={hintInline}>
                    {t(`orders.outcome.${order.outcome}`)}, {t(`orders.state.${order.state}`)}
                  </span>
                </p>
              ) : (
                <StartOrderForm words={words} start={startOrderAction.bind(null, tenantId, enquiryId, selected.id)} orderId={newOrderId} role={role} secondFactorMissing={secondFactorMissing} />
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {showView && quotes.length > 1 ? (
        <div>
          <h3 className={pageH3}>{t("enq.earlier_quotes_of_this_enquiry")}</h3>
          <ul className={listPlain}>
            {quotes.map((q) => (
              <li key={q.id}>
                <Link href={`${base}?quote=${q.id}`} className={link} aria-current={selected?.id === q.id ? "true" : undefined}>
                  {t("enq.quote_n", { n: q.quote_no })}
                </Link>{" "}
                <span className={hintInline}>
                  {t(`enq.outcome.${q.outcome}`)}, {formatRupees(q.total_paise)}
                  {isManual(q) ? t("enq.typed_prices_2") : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
