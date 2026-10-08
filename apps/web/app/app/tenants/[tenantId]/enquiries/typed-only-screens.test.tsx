import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { parseEnquiry, parseRequirementView } from "@/lib/api/enquiries";
import { parseQuote, parseQuoteSummary, parseSetup } from "@/lib/api/quotes";
import { ENQ, MANUAL_QUOTE_JSON, MANUAL_SUMMARY_JSON, QUOTE_JSON, SETUP_JSON, SUMMARY_JSON } from "@/lib/api/quotes-fixtures";

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
vi.mock("./manual-quote-actions", () => ({ createManualQuoteAction: vi.fn(async () => undefined) }));

import { QuotePanel } from "./quote-panel";
import { RequirementPanel } from "./requirement-panel";

const TENANT = "22222222-2222-2222-2222-222222222222";
const REQ = "66666666-6666-4666-8666-666666666666";
const NOTICES = { missing: ["no_requirement", "no_price_list", "no_policy"], price_list_version_id: null, policy_version_id: null, requirement_id: null, requirement_status: null, lines: [], price_list: [] };

function panel(quotes: ReturnType<typeof parseQuoteSummary>[], selected: ReturnType<typeof parseQuote> | null, over: object = NOTICES) {
  return render(
    <QuotePanel tenantId={TENANT} enquiryId={ENQ} role="owner" secondFactorMissing={false} setup={parseSetup({ ...SETUP_JSON, ...over })} quotes={quotes} selected={selected} text={null} textError={null} newQuoteId="77777777-7777-4777-8777-777777777777" />,
  );
}

describe("the list-flow notices on the quote panel", () => {
  it("are not shown on an enquiry that has only typed-price quotes", () => {
    panel([parseQuoteSummary(MANUAL_SUMMARY_JSON)], parseQuote(MANUAL_QUOTE_JSON));
    expect(screen.queryByText(/no price list in force/)).toBeNull();
    expect(screen.queryByText(/no quote policy in force/)).toBeNull();
    expect(screen.queryByText("This enquiry has no requirement yet.")).toBeNull();
    expect(screen.queryByText("Approve the requirement first.")).toBeNull();
    expect(screen.getByRole("heading", { name: "Quote 4" })).toBeInTheDocument();
  });
  it("are shown on an enquiry that has only list-price quotes", () => {
    panel([parseQuoteSummary(SUMMARY_JSON)], parseQuote(QUOTE_JSON));
    expect(screen.getByText(/no price list in force/)).toBeInTheDocument();
    expect(screen.getByText("This enquiry has no requirement yet.")).toBeInTheDocument();
  });
  it("are shown when the enquiry has a list-price quote beside the typed-price ones", () => {
    panel([parseQuoteSummary(MANUAL_SUMMARY_JSON), parseQuoteSummary(SUMMARY_JSON)], parseQuote(MANUAL_QUOTE_JSON));
    expect(screen.getByText(/no price list in force/)).toBeInTheDocument();
  });
  it("are shown on an enquiry with no quote yet", () => {
    panel([], null);
    expect(screen.getByText(/no price list in force/)).toBeInTheDocument();
  });
  it("a notice about the suggestions being unavailable is hidden too on a typed-price enquiry", () => {
    panel([parseQuoteSummary(MANUAL_SUMMARY_JSON)], parseQuote(MANUAL_QUOTE_JSON), { missing: ["mapper_unavailable"] });
    expect(screen.queryByText(/Product suggestions are not available/)).toBeNull();
  });
});

const enquiry = parseEnquiry({
  id: ENQ, lead_id: "33333333-3333-3333-3333-333333333333", company_id: null, contact_id: null, channel: "whatsapp", received_at: "2026-10-05T10:00:00+00:00", subject: null, body: "Need 20 sarees.",
  truncated_from: null, created_by: null, created_at: "2026-10-05T10:01:00+00:00", archived_at: null,
});
const summary = { id: REQ, status: "confirmed", created_via: "manual", agent_run_id: null, confirmed_by: "55555555-5555-4555-8555-555555555555", confirmed_at: "2026-10-05T10:05:00+00:00", created_at: "2026-10-05T10:05:00+00:00" };
const fieldless = parseRequirementView({ requirement: summary, fields: [], lines: [], confirmable: false, ready_for_quote: false, flags: [], questions: [] });

describe("the requirement panel of an enquiry quoted with typed prices", () => {
  it("says so in one plain sentence instead of the line-by-line wording", () => {
    render(<RequirementPanel tenantId={TENANT} enquiry={enquiry} view={fieldless} canWrite={true} runId="55555555-5555-4555-8555-555555555555" />);
    expect(screen.getByText("This enquiry is quoted with typed prices, so there are no lines to approve here.")).toBeInTheDocument();
    for (const gone of [/Not ready for a quote/, /Cannot approve yet/, /Approving needs a saree type/, /No fields yet/, /Add a field the suggestions missed/, /Suggest the fields/]) expect(screen.queryByText(gone)).toBeNull();
  });
  it("keeps only the way out for a writer: discard, behind its explicit control", () => {
    render(<RequirementPanel tenantId={TENANT} enquiry={enquiry} view={fieldless} canWrite={true} runId="55555555-5555-4555-8555-555555555555" />);
    expect(screen.getByText("Discard this requirement")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve requirement" })).toBeNull();
  });
  it("a reader gets the sentence and no control", () => {
    render(<RequirementPanel tenantId={TENANT} enquiry={enquiry} view={fieldless} canWrite={false} runId="55555555-5555-4555-8555-555555555555" />);
    expect(screen.getByText(/quoted with typed prices/)).toBeInTheDocument();
    expect(screen.queryByText("Discard this requirement")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("a requirement with no fields that is NOT approved still gets the line-by-line panel", () => {
    const draft = parseRequirementView({ requirement: { ...summary, status: "draft", created_via: "agent" }, fields: [], lines: [], confirmable: false, ready_for_quote: false, flags: [], questions: [] });
    render(<RequirementPanel tenantId={TENANT} enquiry={enquiry} view={draft} canWrite={true} runId="55555555-5555-4555-8555-555555555555" />);
    expect(screen.getByText(/Approving needs a saree type/)).toBeInTheDocument();
    expect(screen.queryByText(/quoted with typed prices/)).toBeNull();
  });
});
