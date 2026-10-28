import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import { QuoteActions, type QuoteFacts, type QuoteStepActions } from "./QuoteActions";
import { BASE, WORDS } from "./mat-test-kit";

const QUOTE: QuoteFacts = { id: "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1", quoteNo: 12, status: "draft", totalPaise: 8879550, advancePaise: 4439775, trips: 2, needsOwner: false, customer: "Sri Rama Builders", validUntil: "2026-10-21" };
const ORDER = { order_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1", order_no: 7, state: "quote_approved", replayed: false, credit: null };
function acts(over: Partial<QuoteStepActions> = {}) {
  return {
    approve: vi.fn(async () => ({ ok: true as const })),
    reject: vi.fn(async () => ({ ok: true as const })),
    order: vi.fn(async () => ({ ok: true as const, order: ORDER })),
    text: vi.fn(async (l: string) => ({ ok: true as const, text: `Quote text in ${l}`, reviewed: l === "en" })),
    ...over,
  } as QuoteStepActions & Record<string, ReturnType<typeof vi.fn>>;
}
function show(over: Partial<React.ComponentProps<typeof QuoteActions>> = {}, a = acts()) {
  render(<QuoteActions quote={QUOTE} role="owner" base={BASE} words={WORDS} actions={a} secondFactorMissing={false} {...over} />);
  return a;
}
const click = (name: string | RegExp) => act(async () => void fireEvent.click(screen.getByRole("button", { name })));
beforeEach(() => refresh.mockClear());

describe("approving a draft", () => {
  it("opens a sheet that shows the total, the amount in words, the advance and the trips", async () => {
    show();
    await click("Check and approve");
    const sheet = screen.getByRole("dialog", { name: "Approve quote 12" });
    expect(within(sheet).getByText("₹88,795.50")).toBeInTheDocument();
    expect(within(sheet).getByText("Rupees Eighty-Eight Thousand Seven Hundred Ninety-Five and Fifty Paise Only")).toBeInTheDocument();
    expect(within(sheet).getByText("₹44,397.75")).toBeInTheDocument();
    expect(within(sheet).getByText("Sri Rama Builders")).toBeInTheDocument();
  });
  it("will not approve until the figures are ticked as checked", async () => {
    const a = show();
    await click("Check and approve");
    const go = screen.getByRole("button", { name: "Approve this quote" });
    expect(go).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /I have checked the figures: Rupees Eighty-Eight/ }));
    expect(go).toBeEnabled();
    await click("Approve this quote");
    expect(a.approve).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("Nothing was sent to the customer");
    expect(refresh).toHaveBeenCalled();
  });
  it("says in our words why the approval was refused, and points the second factor to Security", async () => {
    show({}, acts({ approve: vi.fn(async () => ({ ok: false as const, error: "This needs your two-step code, if you turned it on.", mfa: true })) as never }));
    await click("Check and approve");
    fireEvent.click(screen.getByRole("checkbox"));
    await click("Approve this quote");
    expect(screen.getByRole("alert")).toHaveTextContent("two-step code");
    expect(screen.getByRole("link", { name: /Security/ })).toHaveAttribute("href", "/app/security");
  });
  it("a quote with a flag cannot be approved by an Admin: the button is off and says whose it is", () => {
    show({ quote: { ...QUOTE, needsOwner: true }, role: "admin" });
    expect(screen.getByRole("button", { name: "Check and approve" })).toBeDisabled();
    expect(screen.getByText(/only the Owner can approve/)).toBeInTheDocument();
  });
  it("Sales cannot approve: no approve button, only turning it down", () => {
    show({ role: "sales" });
    expect(screen.queryByRole("button", { name: "Check and approve" })).toBeNull();
    expect(screen.getByRole("button", { name: "Turn it down" })).toBeInTheDocument();
    expect(screen.getByText(/The Owner or an Admin approves it/)).toBeInTheDocument();
  });
  it("a Viewer sees no button at all", () => {
    show({ role: "viewer" });
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("turning a draft down", () => {
  it("asks for a reason from the closed list", async () => {
    const a = show();
    await click("Turn it down");
    fireEvent.change(screen.getByLabelText("Why?"), { target: { value: "duplicate" } });
    await act(async () => void fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Turn it down" })));
    expect(a.reject).toHaveBeenCalledWith("duplicate");
  });
});

describe("making an order", () => {
  it("is offered for an approved quote, shows the amount in words and says what happens", async () => {
    const a = show({ quote: { ...QUOTE, status: "approved" } });
    expect(screen.queryByRole("button", { name: "Check and approve" })).toBeNull();
    await click("Make an order");
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).getByText(/total ₹88,795.50, advance ₹44,397.75/)).toBeInTheDocument();
    expect(within(sheet).getByText(/Rupees Eighty-Eight Thousand/)).toBeInTheDocument();
    await click("Make the order");
    expect(a.order).toHaveBeenCalledTimes(1);
    expect((a.order as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(screen.getByRole("status")).toHaveTextContent("Order 7 is made.");
    expect(screen.getByRole("link", { name: "Open the order" })).toHaveAttribute("href", `${BASE}/orders/${ORDER.order_id}`);
  });
  it("warns about the credit limit in the order's answer, and never blocks", async () => {
    show({ quote: { ...QUOTE, status: "approved" } }, acts({ order: vi.fn(async () => ({ ok: true as const, order: { ...ORDER, credit: { credit_limit_paise: 5000000, outstanding_paise: 3000000, would_be_paise: 11879550, exceeded: true } } })) as never }));
    await click("Make an order");
    await click("Make the order");
    expect(screen.getByRole("status")).toHaveTextContent("goes over their credit limit of ₹50,000.00 (to ₹1,18,795.50)");
    expect(screen.getByRole("status")).toHaveTextContent("Order 7 is made.");
  });
  it("a draft offers no order", () => {
    show();
    expect(screen.queryByRole("button", { name: "Make an order" })).toBeNull();
  });
});

describe("the WhatsApp message", () => {
  it("shows the text in the chosen language, marks a machine draft, and copies it; it never builds a WhatsApp link", async () => {
    const write = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText: write } });
    const a = show({ quote: { ...QUOTE, status: "approved" } });
    expect(screen.getByText(/Choose a language to see the message/)).toBeInTheDocument();
    await click("Telugu");
    expect(a.text).toHaveBeenCalledWith("te");
    expect(screen.getByText("Quote text in te")).toBeInTheDocument();
    expect(screen.getByText(/machine draft/)).toBeInTheDocument();
    await click("English");
    expect(screen.queryByText(/machine draft/)).toBeNull();
    await click("Copy the message");
    expect(write).toHaveBeenCalledWith("Quote text in en");
    expect(document.querySelector('a[href*="wa.me"], a[href^="whatsapp"]')).toBeNull();
    expect(screen.getByRole("link", { name: "Open the printable quotation" })).toHaveAttribute("href", `${BASE}/quotes/${QUOTE.id}/print`);
  });
});

describe("the second factor", () => {
  it("is mentioned in advance when it is missing for someone who approves", () => {
    show({ secondFactorMissing: true });
    expect(screen.getByText(/Approving needs your two-step code/)).toBeInTheDocument();
  });
});
