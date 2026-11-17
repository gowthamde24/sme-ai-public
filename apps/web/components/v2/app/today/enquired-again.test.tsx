import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));
vi.mock("../visits/LazySlotPicker", async () => ({ SlotPicker: (await import("../visits/SlotPicker")).SlotPicker }));

import { parseNeedsYouItem, parseToday } from "@/lib/api/today";

import { NeedsYou } from "./NeedsYou";
import { NeedsProvider } from "./needs-store";
import { NOW, U, WORDS, classic, fakeActions } from "./today-test-kit";

const SUMMARY = "A customer you already know enquired again. Reply or call back: a repeat customer is a warm lead.";
const LEAD = "99999999-9999-4999-8999-999999999999";
const API_ITEM = { kind: "enquired_again", id: U, customer: "Ramesh K.", city: null, agent: "followup_desk", summary: SUMMARY, at: "2026-11-17T09:12:00Z", amount_paise: null, target: { type: "lead", id: LEAD } };
afterEach(cleanup);

describe("Needs you: a known customer enquired again (C1 #799, 17 Nov)", () => {
  it("reads the API's item: the kind, the lead target, no amount, the customer's name", () => {
    expect(parseNeedsYouItem(API_ITEM)).toMatchObject({ kind: "enquired_again", customer: "Ramesh K.", amount_paise: null, target: { type: "lead", id: LEAD } });
  });
  it("Today draws it (it is not skipped as an unknown kind), and still skips a kind it does not know", () => {
    const today = parseToday({ cards: { waiting: 2, money_held_paise: 0, orders_open: 0 }, needs_you: [API_ITEM, { ...API_ITEM, id: LEAD, kind: "something_new" }], recent: [] });
    expect(today.needs_you.map((i) => i.kind)).toEqual(["enquired_again"]);
    expect(today.skipped).toBe(1);
  });
  it("the card says Enquired again in our words, in the hot-lead tone, and opens the chat", () => {
    const card = classic({ kind: "enquired_again", customer: "Ramesh K.", city: null, agent: "followup_desk", summary: "English from the API", amount_paise: null, target: { type: "lead", id: LEAD }, href: `/app/tenants/T/chats/${LEAD}` });
    render(
      <NeedsProvider initial={[{ ...card, key: `enquired_again-${U}` }]} waiting={1}>
        <NeedsYou words={WORDS} role="owner" actions={fakeActions()} now={NOW} lang="en" compact={false} />
      </NeedsProvider>,
    );
    const a = screen.getByRole("article", { name: /Ramesh K\./ });
    expect(within(a).getByText("Enquired again")).toBeInTheDocument();
    expect(within(a).getByRole("link", { name: /Open chat/ })).toHaveAttribute("href", `/app/tenants/T/chats/${LEAD}`);
  });
});
