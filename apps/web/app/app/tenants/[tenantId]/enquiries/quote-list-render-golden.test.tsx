import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { parseQuote, parseQuoteSummary, parseQuoteText, parseSetup } from "@/lib/api/quotes";
import { ENQ, P1, QUOTE_JSON, SETUP_JSON, SUMMARY_JSON, TEXT_JSON } from "@/lib/api/quotes-fixtures";

vi.mock("./quote-actions", () => ({
  approveQuoteAction: vi.fn(async () => undefined),
  createQuoteAction: vi.fn(async () => undefined),
  pickProductAction: vi.fn(async () => undefined),
  rejectQuoteAction: vi.fn(async () => undefined),
  withdrawQuoteAction: vi.fn(async () => undefined),
}));

import { QuotePanel } from "./quote-panel";
import { QuoteView } from "./quote-view";

/**
 * A LIST-price quote must look exactly as it did before manual-price quotes reached the screen (manual-price quote, slice 4a). The file golden/list-quote-render.json
 * holds the HTML of the quote view and of the whole quote panel for a list-price draft and approved quote, captured from the code BEFORE slice 4a. This test renders the
 * same inputs and compares every character. (Set UPDATE_GOLDEN=1 only on code known to be the old behaviour.)
 */
const GOLDEN = join(__dirname, "golden", "list-quote-render.json");
const TENANT = "22222222-2222-2222-2222-222222222222";
const quote = (over: object = {}) => parseQuote({ ...QUOTE_JSON, ...over });
const flagged = {
  engine_flags: ["BELOW_MINIMUM_ORDER_QUANTITY"],
  review_flags: ["REPEAT_CUSTOMER_CLAIMED", "MIXED_GST_RATES_SHIPPING"],
  needs_owner_approval: true,
};
const approved = { status: "approved", outcome: "approved", approved_by: "55555555-5555-4555-8555-555555555555", approved_at: "2026-10-06T06:00:00+00:00" };
const picked = parseSetup({ ...SETUP_JSON, lines: [{ ...SETUP_JSON.lines[0], pick: { product_id: P1, qty: 20, sale_unit: "piece", source: "manual" } }, SETUP_JSON.lines[1]] });

function html(node: React.ReactElement): string {
  const { container, unmount } = render(node);
  // a <time> element shows the clock in the reader's zone and "3 days ago": it differs by machine and by day, so its text is replaced by a fixed word before comparing
  const out = container.innerHTML.replace(/<time[^>]*>[^<]*<\/time>/g, "<time/>");
  unmount();
  return out;
}

function capture(): Record<string, string> {
  const panel = (role: string, selected: ReturnType<typeof quote> | null, withText: boolean) =>
    html(
      <QuotePanel
        tenantId={TENANT}
        enquiryId={ENQ}
        role={role}
        secondFactorMissing={false}
        setup={picked}
        quotes={[parseQuoteSummary(SUMMARY_JSON)]}
        selected={selected}
        text={withText ? parseQuoteText(TEXT_JSON) : null}
        textError={null}
        newQuoteId="77777777-7777-4777-8777-777777777777"
      />,
    );
  return {
    view_draft: html(<QuoteView quote={quote()} stateName="Maharashtra" />),
    view_flagged: html(<QuoteView quote={quote(flagged)} stateName="Maharashtra" />),
    view_approved: html(<QuoteView quote={quote(approved)} stateName="Maharashtra" />),
    panel_sales_no_quote: panel("sales", null, false),
    panel_sales_draft: panel("sales", quote(), false),
    panel_owner_draft: panel("owner", quote(), false),
    panel_owner_flagged: panel("owner", quote(flagged), false),
    panel_admin_approved: panel("admin", quote(approved), true),
  };
}

describe("a list-price quote looks as it did before manual-price quotes", () => {
  it("renders the same HTML, character for character", () => {
    const got = capture();
    if (process.env.UPDATE_GOLDEN === "1") writeFileSync(GOLDEN, JSON.stringify(got, null, 1) + "\n");
    const expected = JSON.parse(readFileSync(GOLDEN, "utf8")) as Record<string, string>;
    expect(Object.keys(got).sort()).toEqual(Object.keys(expected).sort());
    for (const name of Object.keys(expected)) expect(got[name], name).toBe(expected[name]);
  });
});
