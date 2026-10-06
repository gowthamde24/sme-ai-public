import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { parseOrder } from "@/lib/api/orders";
import { ORDER_JSON } from "@/lib/api/orders-fixtures";
import { parseQuote, parseSetup } from "@/lib/api/quotes";
import { ENQ, QUOTE_JSON, SETUP_JSON } from "@/lib/api/quotes-fixtures";

vi.mock("./quote-actions", () => ({
  approveQuoteAction: vi.fn(async () => undefined),
  createQuoteAction: vi.fn(async () => undefined),
  pickProductAction: vi.fn(async () => undefined),
  rejectQuoteAction: vi.fn(async () => undefined),
  withdrawQuoteAction: vi.fn(async () => undefined),
}));
vi.mock("../orders/order-actions", () => ({ startOrderAction: vi.fn(async () => undefined), recordEventAction: vi.fn(async () => undefined) }));

import { QuotePanel } from "./quote-panel";

const TENANT = "22222222-2222-2222-2222-222222222222";
const approved = parseQuote({ ...QUOTE_JSON, status: "approved", outcome: "approved", approved_at: "2026-10-06T06:00:00+00:00" });
const draft = parseQuote(QUOTE_JSON);

function panel(over: Partial<Parameters<typeof QuotePanel>[0]> = {}) {
  return render(
    <QuotePanel
      tenantId={TENANT}
      enquiryId={ENQ}
      role="owner"
      secondFactorMissing={false}
      setup={parseSetup(SETUP_JSON)}
      quotes={[]}
      selected={approved}
      text={null}
      textError={null}
      newQuoteId="77777777-7777-4777-8777-777777777777"
      newOrderId="55555555-5555-4555-8555-555555555555"
      {...over}
    />,
  );
}

describe("the Order section of the quote panel", () => {
  it.each(["owner", "admin"])("an approved quote with no order offers %s the Start order button", (role) => {
    panel({ role });
    expect(screen.getByRole("heading", { name: "Order" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start order" })).toBeInTheDocument();
  });

  it("without the second factor it is the notice, not the button", () => {
    panel({ secondFactorMissing: true });
    expect(screen.getAllByText(/Starting an order needs your authenticator app/)).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Start order" })).toBeNull();
  });

  it("sales is told who starts an order", () => {
    panel({ role: "sales" });
    expect(screen.getByText("An owner or admin starts an order from an approved quote.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start order" })).toBeNull();
  });

  it("an order that exists is linked, with its state in our words, and the button is gone", () => {
    panel({ order: parseOrder(ORDER_JSON) });
    expect(screen.getByRole("link", { name: "Order 7" })).toHaveAttribute("href", `/app/tenants/${TENANT}/orders/${ORDER_JSON.id}`);
    expect(screen.getByText("Open, Quote approved")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start order" })).toBeNull();
  });

  it("a draft quote has no order section", () => {
    panel({ selected: draft });
    expect(screen.queryByRole("heading", { name: "Order" })).toBeNull();
  });
});
