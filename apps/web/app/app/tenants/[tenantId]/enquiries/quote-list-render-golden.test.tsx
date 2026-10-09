import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { parseEnquiry, parseRequirementView } from "@/lib/api/enquiries";
import { parseQuote, parseQuoteSummary, parseQuoteText, parseSetup } from "@/lib/api/quotes";
import { ENQ, P1, QUOTE_JSON, SETUP_JSON, SUMMARY_JSON, TEXT_JSON } from "@/lib/api/quotes-fixtures";

vi.mock("./actions", () => ({
  captureEnquiryAction: vi.fn(async () => undefined),
  extractRequirementAction: vi.fn(async () => undefined),
  decideFieldAction: vi.fn(async () => undefined),
  addFieldAction: vi.fn(async () => undefined),
  confirmRequirementAction: vi.fn(async () => undefined),
  discardRequirementAction: vi.fn(async () => undefined),
}));
vi.mock("./quote-actions", () => ({
  approveQuoteAction: vi.fn(async () => undefined),
  createQuoteAction: vi.fn(async () => undefined),
  pickProductAction: vi.fn(async () => undefined),
  rejectQuoteAction: vi.fn(async () => undefined),
  withdrawQuoteAction: vi.fn(async () => undefined),
}));

import { QuotePanel } from "./quote-panel";
import { RequirementPanel } from "./requirement-panel";
import { QuoteView } from "./quote-view";

/**
 * A LIST-price quote must look exactly as it did before manual-price quotes reached the screen (manual-price quote, slice 4a). The file golden/list-quote-render.json
 * holds the HTML of the quote view and of the whole quote panel for a list-price draft and approved quote, captured from the code BEFORE slice 4a. This test renders the
 * same inputs and compares every character. (Set UPDATE_GOLDEN=1 only on code known to be the old behaviour.)
 *
 * Re-captured ONCE, on purpose, in the commit "golden: re-capture list-quote after v2" (workspace redesign, Batch 1B-quote): the quote screen moved to the v2 look, so every class
 * name and the markup around the words changed. What this golden stood for, "a list-price quote says the same thing", is now proved by the plain-text snapshot of the enquiry screens
 * (apps/web/test/screens/__text__, captured from main before the restyle and unchanged by it) and by the check that the text of all 15 pieces below is identical before and after.
 * Do not re-capture it again for a change of words: that needs the owner.
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

const REQ = "66666666-6666-4666-8666-666666666666";
const FIELD = (id: string, line_no: number | null, field_key: string, display: string, state: string) => ({
  id, line_no, field_key, value: { code: field_key === "saree_type" ? "kanjivaram" : null, int_value: field_key === "quantity" ? 20 : null, date_value: null, text: null, basis: field_key === "quantity" ? "piece" : null },
  display, certainty: "stated", state, conflict: false, created_via: "agent", quote: "20 kanjivaram", quote_start: 5, quote_end: 18, decided_by: null, decided_at: null,
});
const requirementView = (status: "draft" | "confirmed", state: string) =>
  parseRequirementView({
    requirement: { id: REQ, status, created_via: "agent", agent_run_id: null, confirmed_by: null, confirmed_at: null, created_at: "2026-10-05T10:05:00+00:00" },
    fields: [FIELD("f1", 1, "saree_type", "Kanjivaram", state), FIELD("f2", 1, "quantity", "20 pieces", state)],
    lines: [1], confirmable: true, ready_for_quote: status === "confirmed",
    flags: [{ kind: "missing", field_key: "delivery_city", line_no: null }], questions: [{ code: "missing_delivery_city", text: "Where should it be delivered?", field_key: "delivery_city", line_no: null }],
  });
const enquiry = parseEnquiry({
  id: ENQ, lead_id: "33333333-3333-3333-3333-333333333333", company_id: null, contact_id: null, channel: "whatsapp", received_at: "2026-10-05T10:00:00+00:00", subject: null, body: "Need 20 kanjivaram sarees.",
  truncated_from: null, created_by: null, created_at: "2026-10-05T10:01:00+00:00", archived_at: null,
});

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
    // the list-flow notices a list-price screen shows when something is missing (these must not change)
    panel_no_price_list: html(<QuotePanel tenantId={TENANT} enquiryId={ENQ} role="sales" secondFactorMissing={false} setup={parseSetup({ ...SETUP_JSON, price_list_version_id: null, policy_version_id: null, missing: ["no_price_list", "no_policy"], price_list: [] })} quotes={[]} selected={null} text={null} textError={null} newQuoteId="77777777-7777-4777-8777-777777777777" />),
    panel_no_requirement: html(<QuotePanel tenantId={TENANT} enquiryId={ENQ} role="owner" secondFactorMissing={false} setup={parseSetup({ ...SETUP_JSON, requirement_id: null, requirement_status: null, missing: ["no_requirement"], lines: [] })} quotes={[]} selected={null} text={null} textError={null} newQuoteId="77777777-7777-4777-8777-777777777777" />),
    panel_list_quote_and_notice: html(<QuotePanel tenantId={TENANT} enquiryId={ENQ} role="owner" secondFactorMissing={false} setup={parseSetup({ ...SETUP_JSON, price_list_version_id: null, missing: ["no_price_list"] })} quotes={[parseQuoteSummary(SUMMARY_JSON)]} selected={quote()} text={null} textError={null} newQuoteId="77777777-7777-4777-8777-777777777777" />),
    // the requirement panel of the line-by-line flow (fields present): draft and approved, for a writer and for a reader
    requirement_draft_sales: html(<RequirementPanel tenantId={TENANT} enquiry={enquiry} view={requirementView("draft", "proposed")} canWrite={true} runId="55555555-5555-4555-8555-555555555555" />),
    requirement_confirmed_owner: html(<RequirementPanel tenantId={TENANT} enquiry={enquiry} view={requirementView("confirmed", "confirmed")} canWrite={true} runId="55555555-5555-4555-8555-555555555555" />),
    requirement_confirmed_reader: html(<RequirementPanel tenantId={TENANT} enquiry={enquiry} view={requirementView("confirmed", "confirmed")} canWrite={false} runId="55555555-5555-4555-8555-555555555555" />),
    requirement_none: html(<RequirementPanel tenantId={TENANT} enquiry={enquiry} view={parseRequirementView({ requirement: null, fields: [], lines: [], confirmable: false, ready_for_quote: false, flags: [], questions: [] })} canWrite={true} runId="55555555-5555-4555-8555-555555555555" />),
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
