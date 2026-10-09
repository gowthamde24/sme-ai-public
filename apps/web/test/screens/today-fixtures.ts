/**
 * Synthetic answers of `GET /today` and `GET /agents/status` for the screen snapshot and the page tests, shaped as the API sends them (job AD report, "The contract as built") and
 * parsed by the real parsers. What each role is given follows the database's rule: Owner everything, Admin the approvals but not the money held, Sales only the cards and the recent steps,
 * Viewer zeros and nothing else.
 */
import { parseAgentsStatus, parseToday, type Today } from "@/lib/api/today";
import { QUOTE } from "@/lib/api/quotes-fixtures";
import { LEAD } from "@/test/screens/fixtures";

/** the quote of SUMMARY_JSON, so the quote list can place it */
export const T_QUOTE = QUOTE;
export const T_ORDER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const AT = "2026-10-06T04:00:00+00:00";

export const TODAY_JSON = {
  cards: { waiting: 3, money_held_paise: 40000, orders_open: 1 },
  needs_you: [
    { kind: "followup_due", id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1", customer: "Synthetic Buyer", city: null, agent: "followup_desk", summary: "A follow-up message (number 2) is drafted and waiting for your approval.", at: "2026-10-06T04:30:00+00:00", amount_paise: null, target: { type: "lead", id: LEAD } },
    { kind: "order_money_held", id: T_ORDER, customer: "Synthetic Buyer", city: "Hyderabad", agent: "order_desk", summary: "Order 1 is closed but still holds ₹400.00. A refund may be owed.", at: "2026-10-06T03:00:00+00:00", amount_paise: 40000, target: { type: "order", id: T_ORDER } },
    { kind: "quote_approval", id: T_QUOTE, customer: "Synthetic Buyer", city: "Hyderabad", agent: "quote_writer", summary: "Quote 1 for ₹50,400.00 is ready for your approval.", at: "2026-10-06T02:00:00+00:00", amount_paise: 5040000, target: { type: "quote", id: T_QUOTE } },
  ],
  recent: [
    { kind: "order_step", order_ref: "Order 2", customer: "Synthetic Buyer", text: "Order started", at: AT, target: { type: "order", id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2" } },
    { kind: "order_step", order_ref: "Order 1", customer: "Synthetic Buyer", text: "Order cancelled", at: "2026-10-05T04:00:00+00:00", target: { type: "order", id: T_ORDER } },
  ],
};

export function todayFor(role: "owner" | "admin" | "sales" | "viewer"): Today {
  if (role === "owner") return parseToday(TODAY_JSON);
  if (role === "admin") return parseToday({ ...TODAY_JSON, cards: { ...TODAY_JSON.cards, waiting: 2 }, needs_you: TODAY_JSON.needs_you.filter((i) => i.kind !== "order_money_held") });
  if (role === "sales") return parseToday({ ...TODAY_JSON, cards: { ...TODAY_JSON.cards, waiting: 0 }, needs_you: [] });
  return parseToday({ cards: { waiting: 0, money_held_paise: 0, orders_open: 0 }, needs_you: [], recent: [] });
}

export const AGENTS_JSON = [
  { agent: "main", state: "not_available", job: "Coordinates the other helpers. Not built yet.", last_event: null },
  { agent: "lead_finder", state: "not_available", job: "Finds new businesses that may want to buy. Not built yet.", last_event: null },
  { agent: "researcher", state: "idle", job: "Reads public pages about a lead and writes down what it finds, with sources.", last_event: null },
  { agent: "requirement_analyst", state: "working", job: "Reads an enquiry and lists what the customer asked for, to be checked.", last_event: null },
  { agent: "quote_writer", state: "idle", job: "Prepares a quote from the prices you set. A person approves it.", last_event: { text: "Prepared quote 3", at: "2026-10-06T03:00:00+00:00" } },
  { agent: "followup_desk", state: "idle", job: "Drafts follow-up messages. A person approves and sends them.", last_event: { text: "Drafted follow-up message number 2", at: "2026-10-06T04:30:00+00:00" } },
  { agent: "order_desk", state: "idle", job: "Keeps each order's steps, payments and refunds in order.", last_event: { text: "Order started", at: AT } },
];
export const agentsStatus = () => parseAgentsStatus(AGENTS_JSON);
