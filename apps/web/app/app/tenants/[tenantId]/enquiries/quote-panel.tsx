import Link from "next/link";

import {
  MISSING_TEXT,
  OUTCOME_LABELS,
  formatRupees,
  type Quote,
  type QuoteSetup,
  type QuoteSummary,
  type QuoteText,
} from "@/lib/api/quotes";

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
import { QuoteView } from "./quote-view";

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
};

/**
 * The quote of one enquiry: a person chooses the product for each approved requirement line (the assistant only suggests), makes a DRAFT, and an owner
 * or admin approves it. After approval the customer-facing text is shown to COPY. This application never sends anything, and the screen says so.
 */
export function QuotePanel({ tenantId, enquiryId, role, secondFactorMissing, setup, quotes, selected, text, textError, newQuoteId }: Props) {
  const confirmed = setup.requirement_status === "confirmed";
  const blockers = setup.missing.filter((m) => m !== "mapper_unavailable");
  const notes = setup.missing.filter((m) => m === "mapper_unavailable");
  const quotable = setup.lines.filter((l) => l.quotable);
  const unquotable = setup.lines.filter((l) => !l.quotable);
  const allPicked = quotable.length > 0 && quotable.every((l) => l.pick !== null);
  const ready = confirmed && blockers.length === 0;
  const stateName = (code: string) => setup.delivery_states[code] ?? code;
  const base = `/app/tenants/${tenantId}/enquiries/${enquiryId}`;
  return (
    <section aria-labelledby="quote-heading">
      <h2 id="quote-heading">Quote</h2>
      <p className="hint">
        A quote is a draft until an owner or admin approves it. Prices come from the price list and the pricing engine, never from a person or an assistant.
        Nothing on this page is ever sent to anyone.
      </p>

      {[...blockers, ...notes].map((m) => (
        <p key={m} role="note" className="notice">
          {MISSING_TEXT[m] ?? "Something this quote needs is missing."}
        </p>
      ))}

      {ready ? (
        <div>
          <h3>1. Choose the product for each line</h3>
          <p className="hint">The assistant suggests products; nothing is chosen until you press the button for that line.</p>
          {quotable.length === 0 ? <p>No line has a saree type and a quantity that a person approved yet.</p> : null}
          {quotable.map((line) => (
            <PickLineForm key={`${line.line_no}-${line.pick?.product_id ?? "none"}-${line.pick?.qty ?? 0}`} pick={pickProductAction.bind(null, tenantId, enquiryId, line.line_no)} line={line} priceList={setup.price_list} />
          ))}
          {unquotable.length > 0 ? (
            <div role="note" className="notice">
              <strong>Not quoted</strong> (approve its saree type and quantity first):
              <ul>
                {unquotable.map((line) => (
                  <li key={line.line_no} className="plain-text">
                    Line {line.line_no}: {line.summary.join("; ")}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <h3>2. Make a draft quote</h3>
          {allPicked ? (
            <CreateQuoteForm create={createQuoteAction.bind(null, tenantId, enquiryId)} quoteId={newQuoteId} states={setup.delivery_states} />
          ) : (
            <p className="hint">Choose a product for every line above first.</p>
          )}
          {quotes.some((q) => q.outcome === "draft") ? <p className="hint">Making a new draft replaces the current draft.</p> : null}
        </div>
      ) : null}

      {selected ? (
        <div>
          <QuoteView quote={selected} stateName={stateName(selected.delivery_state)} />
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
              <h3>Text for the customer</h3>
              {text ? (
                <CopyText text={text.text} />
              ) : (
                <p role="alert" className="error hint">
                  The text could not be prepared right now ({textError ?? "unavailable"}). The approval stands: reload the page to try again. Nothing was sent.
                </p>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {quotes.length > 1 ? (
        <div>
          <h3>Earlier quotes of this enquiry</h3>
          <ul>
            {quotes.map((q) => (
              <li key={q.id}>
                <Link href={`${base}?quote=${q.id}`} className="tap" aria-current={selected?.id === q.id ? "true" : undefined}>
                  Quote {q.quote_no}
                </Link>{" "}
                <span className="hint">
                  {OUTCOME_LABELS[q.outcome]}, {formatRupees(q.total_paise)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
