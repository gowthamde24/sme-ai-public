import Link from "next/link";

import {
  MISSING_TEXT,
  OUTCOME_LABELS,
  formatRupees,
  isManual,
  type Quote,
  type QuoteSetup,
  type QuoteSummary,
  type QuoteText,
} from "@/lib/api/quotes";

import { OUTCOME_LABELS as ORDER_OUTCOME_LABELS, STATE_LABELS as ORDER_STATE_LABELS, type Order } from "@/lib/api/orders";

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
};

export type ManualQuoteData = { unavailable: false; itemTypes: ItemType[]; gst: GstInForce | null; newQuoteId: string } | { unavailable: true };

/**
 * The quote of one enquiry: a person chooses the product for each approved requirement line (the assistant only suggests), makes a DRAFT, and an owner
 * or admin approves it. After approval the customer-facing text is shown to COPY. This application never sends anything, and the screen says so.
 */
export function QuotePanel({ tenantId, enquiryId, role, secondFactorMissing, setup, quotes, selected, text, textError, newQuoteId, order = null, newOrderId, whatsapp = null, sentOnWhatsapp = null, manual = null }: Props) {
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
      <h2 id="quote-heading" className={pageH2}>
        Quote
      </h2>
      <p className={mutedText}>
        A quote is a draft until an owner or admin approves it. {typedPrices ? "Prices come from the price list, or are typed by an owner or an admin; the pricing engine works out GST and the totals, never an assistant." : "Prices come from the price list and the pricing engine, never from a person or an assistant."}{" "}
        Nothing on this page is ever sent to anyone.
      </p>

      {(typedOnly ? [] : [...blockers, ...notes]).map((m) => (
        <p key={m} role="note" className={noteBox}>
          {MISSING_TEXT[m] ?? "Something this quote needs is missing."}
        </p>
      ))}

      {ready ? (
        <div>
          <h3 className={pageH3}>1. Choose the product for each line</h3>
          <p className={mutedText}>The assistant suggests products; nothing is chosen until you press the button for that line.</p>
          {quotable.length === 0 ? <p className={bigText}>No line has a saree type and a quantity that a person approved yet.</p> : null}
          {quotable.map((line) => (
            <PickLineForm key={`${line.line_no}-${line.pick?.product_id ?? "none"}-${line.pick?.qty ?? 0}`} pick={pickProductAction.bind(null, tenantId, enquiryId, line.line_no)} line={line} priceList={setup.price_list} />
          ))}
          {unquotable.length > 0 ? (
            <div role="note" className={noteBox}>
              <strong>Not quoted</strong> (approve its saree type and quantity first):
              <ul className={bulletList}>
                {unquotable.map((line) => (
                  <li key={line.line_no} className={plainText}>
                    Line {line.line_no}: {line.summary.join("; ")}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <h3 className={pageH3}>2. Make a draft quote</h3>
          {allPicked ? (
            <CreateQuoteForm create={createQuoteAction.bind(null, tenantId, enquiryId)} quoteId={newQuoteId} states={setup.delivery_states} />
          ) : (
            <p className={mutedText}>Choose a product for every line above first.</p>
          )}
          {quotes.some((q) => q.outcome === "draft") ? <p className={mutedText}>Making a new draft replaces the current draft.</p> : null}
        </div>
      ) : null}

      {manual ? (
        <div>
          {ready ? <p className={mutedText}>Or make a quote with typed prices instead of using the price list:</p> : null}
          {manual.unavailable ? (
            <p role="alert" className={alertBox}>
              The item types or the quote policy could not be loaded right now. Reload the page to try again.
            </p>
          ) : (
            <>
              <ManualQuoteForm create={createManualQuoteAction.bind(null, tenantId, enquiryId)} quoteId={manual.newQuoteId} itemTypes={manual.itemTypes} gst={manual.gst} />
              {quotes.some((q) => q.outcome === "draft") ? <p className={mutedText}>Making a new draft replaces the current draft.</p> : null}
            </>
          )}
        </div>
      ) : null}

      {selected ? (
        <div>
          <QuoteView quote={selected} stateName={selected.delivery_state === null ? "" : stateName(selected.delivery_state)} />
          <QuoteDecisions
            approve={approveQuoteAction.bind(null, tenantId, enquiryId, selected.id)}
            reject={rejectQuoteAction.bind(null, tenantId, enquiryId, selected.id)}
            withdraw={withdrawQuoteAction.bind(null, tenantId, enquiryId, selected.id)}
            outcome={selected.outcome}
            role={role}
            needsOwnerApproval={selected.needs_owner_approval}
            secondFactorMissing={secondFactorMissing}
          />
          {selected.outcome === "approved" ? (
            <div>
              <h3 className={pageH3}>Text for the customer</h3>
              {text ? (
                <>
                  <CopyText text={text.text} />
                  {whatsapp ? <WhatsappActions tenantId={tenantId} quoteId={selected.id} view={whatsapp} sent={sentOnWhatsapp} /> : null}
                </>
              ) : (
                <p role="alert" className={alertBox}>
                  The text could not be prepared right now ({textError ?? "unavailable"}). The approval stands: reload the page to try again. Nothing was sent.
                </p>
              )}
            </div>
          ) : null}
          {selected.outcome === "approved" && newOrderId ? (
            <div>
              <h3 className={pageH3}>Order</h3>
              {order ? (
                <p>
                  <Link href={`/app/tenants/${tenantId}/orders/${order.id}`} className={link}>
                    Order {order.order_no}
                  </Link>{" "}
                  <span className={hintInline}>
                    {ORDER_OUTCOME_LABELS[order.outcome]}, {ORDER_STATE_LABELS[order.state]}
                  </span>
                </p>
              ) : (
                <StartOrderForm start={startOrderAction.bind(null, tenantId, enquiryId, selected.id)} orderId={newOrderId} role={role} secondFactorMissing={secondFactorMissing} />
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {quotes.length > 1 ? (
        <div>
          <h3 className={pageH3}>Earlier quotes of this enquiry</h3>
          <ul className={listPlain}>
            {quotes.map((q) => (
              <li key={q.id}>
                <Link href={`${base}?quote=${q.id}`} className={link} aria-current={selected?.id === q.id ? "true" : undefined}>
                  Quote {q.quote_no}
                </Link>{" "}
                <span className={hintInline}>
                  {OUTCOME_LABELS[q.outcome]}, {formatRupees(q.total_paise)}
                  {isManual(q) ? ", typed prices" : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
