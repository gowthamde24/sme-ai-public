import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ORDER_STATES, OUTCOME_LABELS, STATE_LABELS, parseMembers, parseOrderDetail, type OrderState } from "@/lib/api/orders";
import { DETAIL_JSON, ENQ, EVENT_JSON, LEAD, MEMBERS_JSON, ORDER, PERSON, QUOTE, TENANT } from "@/lib/api/orders-fixtures";

import { OrderView, whoText } from "./order-view";

const members = parseMembers(MEMBERS_JSON);
const show = (over: Record<string, unknown> = {}, forms = <p>FORMS</p>) =>
  render(<OrderView tenantId={TENANT} order={parseOrderDetail({ ...DETAIL_JSON, ...over })} members={members} forms={forms} />);

describe("OrderView", () => {
  it("says up front that nothing is sent and that every entry is a record", () => {
    show();
    expect(screen.getByRole("note")).toHaveTextContent("Nothing is sent by this system: every entry here is a record of something that happened outside it.");
  });

  it.each(ORDER_STATES)("shows the %s state in our words with its outcome", (state) => {
    const outcome: Record<OrderState, string> = {
      quote_approved: "open", quote_sent: "open", accepted: "won", advance_requested: "won", advance_paid: "won", in_preparation: "won", dispatched: "won", delivered: "won",
      closed_paid: "won", declined: "lost", expired: "expired", cancelled: "cancelled",
    }; // fmt: skip
    show({ state, outcome: outcome[state] });
    expect(document.querySelector("#order-heading")).toHaveTextContent(`${OUTCOME_LABELS[outcome[state] as keyof typeof OUTCOME_LABELS]} · ${STATE_LABELS[state]}`);
  });

  it("shows the figures in rupees with Indian grouping: four boxes (total, received, balance, money held) and the rest of the ledger", () => {
    show({ order_total_paise: 15000050, advance_paise: 7500000, paid_paise: 7500000, refunded_paise: 100000, net_paise: 7400000, balance_paise: 7600050 });
    const box = (label: string) => screen.getByText(label, { selector: "p" }).nextElementSibling?.textContent;
    expect(box("Order total")).toBe("₹1,50,000.50");
    expect(box("Received")).toBe("₹75,000.00");
    expect(box("Balance")).toBe("₹76,000.50");
    expect(box("Money held")).toBe("₹0.00"); // always drawn; amber only when something is held
    const ledger = screen.getByText("Advance asked for", { selector: "dt" }).closest("dl") as HTMLElement;
    const text = (label: string) => within(ledger).getByText(label).nextElementSibling?.textContent;
    expect(text("Advance asked for")).toBe("₹75,000.00");
    expect(text("Refunded")).toBe("₹1,000.00");
    expect(text("Net received")).toBe("₹74,000.00");
    expect(text("Quote valid until")).toBe("21 Oct 2026");
  });

  it.each(["declined", "cancelled", "expired"])("a %s order owes nothing and says so", (state) => {
    show({ state, outcome: state === "declined" ? "lost" : state, balance_paise: 99900 });
    expect(screen.getByText("Balance", { selector: "p" }).nextElementSibling).toHaveTextContent("–");
    expect(screen.getByText("Balance: not owed, the order is closed.")).toBeInTheDocument();
  });

  it("draws the steps of the order: reached ones checked, the current one marked, the rest 'Not reached'; a cancelled order ends at Cancelled", () => {
    show({ state: "advance_requested", outcome: "won", events: [EVENT_JSON, { ...EVENT_JSON, id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc2", seq: 2, new_state: "accepted" }, { ...EVENT_JSON, id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc3", seq: 3, new_state: "advance_requested" }] });
    const steps = within(screen.getByRole("list", { name: "The steps of an order" })).getAllByRole("listitem");
    expect(steps).toHaveLength(8);
    expect(steps[2]).toHaveAttribute("aria-current", "step");
    expect(steps[2]).toHaveTextContent("Advance asked for");
    expect(steps[3]).toHaveTextContent("Advance receivedNot reached");
    document.body.innerHTML = "";
    show({ state: "cancelled", outcome: "cancelled" });
    const ended = within(screen.getByRole("list", { name: "The steps of an order" })).getAllByRole("listitem");
    expect(ended[ended.length - 1]).toHaveTextContent("Cancelled");
    expect(ended[ended.length - 1]).toHaveAttribute("aria-current", "step");
  });

  it("names the lost reason", () => {
    show({ state: "declined", outcome: "lost", lost_reason: "price" });
    expect(screen.getByText(/The price/)).toBeInTheDocument();
  });

  it("links the quote, the enquiry and the lead", () => {
    show();
    expect(screen.getByRole("link", { name: "The approved quote" })).toHaveAttribute("href", `/app/tenants/${TENANT}/enquiries/${ENQ}?quote=${QUOTE}`);
    expect(screen.getByRole("link", { name: "The enquiry" })).toHaveAttribute("href", `/app/tenants/${TENANT}/enquiries/${ENQ}`);
    expect(screen.getByRole("link", { name: "The lead" })).toHaveAttribute("href", `/app/tenants/${TENANT}/leads/${LEAD}`);
  });

  it("puts the forms under 'What to record next'", () => {
    show();
    expect(screen.getByRole("heading", { name: "What to record next" })).toBeInTheDocument();
    expect(screen.getByText("FORMS")).toBeInTheDocument();
  });

  it("the history says what happened, how the state moved, who recorded it and when", () => {
    const events = [
      EVENT_JSON,
      { ...EVENT_JSON, id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc2", seq: 2, type: "record_payment", prior_state: "advance_requested", new_state: "advance_paid", amount_paise: 7500000, ledger_id: ORDER, owner_approved_by: PERSON },
      { ...EVENT_JSON, id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc3", seq: 3, type: "customer_decline", prior_state: "quote_sent", new_state: "declined", reason_code: "timing", recorded_by: null },
    ];
    show({ events });
    const items = within(screen.getByRole("list", { name: "Events, oldest first" })).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("Order started from the approved quote");
    expect(items[0]).toHaveTextContent("recorded by Asha (synthetic) (owner)");
    expect(items[1]).toHaveTextContent("A payment was received · ₹75,000.00");
    expect(items[1]).toHaveTextContent("Advance asked for → Advance received");
    expect(items[1]).toHaveTextContent("with the owner's approval");
    expect(items[2]).toHaveTextContent("The customer declined · The timing");
    expect(items[2]).toHaveTextContent("recorded by The system");
  });

  it("shows no id, hash or engine detail of an event", () => {
    const { container } = show({ events: [{ ...EVENT_JSON, engine_version: "1.0.0", canonical_hash: "ab".repeat(32), ledger_id: ORDER }] });
    expect(container.textContent).not.toContain("ab".repeat(32));
    expect(container.textContent).not.toContain(ORDER);
  });
});

describe("money still held (step F8)", () => {
  const LINE = /Money still held: ₹[\d,]+\.\d{2}\. A refund may be owed to the customer\./;
  it("the rehearsal's order F (paid 8,820, refunded 1,000) shows a permanent line with 7,820.00", () => {
    show({ state: "cancelled", outcome: "cancelled", paid_paise: 882000, refunded_paise: 100000, net_paise: 782000, balance_paise: 2746000 });
    expect(screen.getByText("Money still held: ₹7,820.00. A refund may be owed to the customer.")).toBeInTheDocument();
    expect(screen.getByText("Money still held: ₹7,820.00. A refund may be owed to the customer.").closest("[role=note]")).not.toBeNull();
    expect(screen.getByText("Money held", { selector: "p" }).nextElementSibling).toHaveTextContent("₹7,820.00");
    expect(screen.getByText("Money held", { selector: "p" }).parentElement?.className).toContain("amber"); // the figure is amber when money is held
    expect(screen.getByText("Balance", { selector: "p" }).nextElementSibling).toHaveTextContent("–");
  });
  it("a closed_paid order has no such line", () => {
    show({ state: "closed_paid", outcome: "won", paid_paise: 15000000, net_paise: 15000000, balance_paise: 0 });
    expect(screen.queryByText(LINE)).toBeNull();
  });
  it("a declined order with no payment has no such line; with a payment it has", () => {
    show({ state: "declined", outcome: "lost", paid_paise: 0, net_paise: 0 });
    expect(screen.queryByText(LINE)).toBeNull();
    document.body.innerHTML = "";
    show({ state: "declined", outcome: "lost", paid_paise: 5000, net_paise: 5000 });
    expect(screen.getByText("Money still held: ₹50.00. A refund may be owed to the customer.")).toBeInTheDocument();
  });
  it("an expired order that holds money has it; an open or in-preparation order has none", () => {
    show({ state: "expired", outcome: "expired", paid_paise: 100, net_paise: 100 });
    expect(screen.getByText(LINE)).toBeInTheDocument();
    document.body.innerHTML = "";
    show({ state: "in_preparation", outcome: "won", paid_paise: 100, net_paise: 100 });
    expect(screen.queryByText(LINE)).toBeNull();
  });
});

describe("whoText", () => {
  it("is a name and role, a role, or 'a team member', never an id", () => {
    expect(whoText(PERSON, members)).toBe("Asha (synthetic) (owner)");
    expect(whoText(PERSON, [{ user_id: PERSON, role: "sales", display_name: null }])).toBe("A sales");
    expect(whoText("ffffffff-ffff-4fff-8fff-fffffffffff1", members)).toBe("A team member");
    expect(whoText(null, members)).toBe("The system");
  });
});
