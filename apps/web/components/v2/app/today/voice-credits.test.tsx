import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));
vi.mock("../visits/LazySlotPicker", async () => ({ SlotPicker: (await import("../visits/SlotPicker")).SlotPicker }));

import { parseNeedsYouItem } from "@/lib/api/today";

import { NeedsYou } from "./NeedsYou";
import { NeedsProvider } from "./needs-store";
import { NOW, U, WORDS, classic, fakeActions } from "./today-test-kit";

const SUMMARY = "Cartesia voice is at 80 percent of today's limit. Past the limit, calls speak with Sarvam Bulbul.";
const API_ITEM = { kind: "voice_credits", id: U, customer: "Voice credits", city: null, agent: "followup_desk", summary: SUMMARY, at: "2026-10-11T03:12:00Z", amount_paise: null, target: { type: "billing", id: U } };
afterEach(cleanup);

describe("Needs you: the voice credits warning (C1, 6 Nov: Cartesia at 80 and 100 percent of the day's limit or the month's credits)", () => {
  it("reads the API's item exactly: the kind, the billing target, no amount", () => {
    expect(parseNeedsYouItem(API_ITEM)).toMatchObject({ kind: "voice_credits", customer: "Voice credits", summary: "₹ balance is low · Top up", amount_paise: null, target: { type: "billing", id: U } });
    expect(() => parseNeedsYouItem({ ...API_ITEM, target: { type: "wallet", id: U } })).toThrow();
  });
  it("shows the API's own sentence on the card and on the row, and opens Plan & usage", () => {
    const card = classic({ kind: "voice_credits", customer: "Voice credits", city: null, agent: "followup_desk", summary: SUMMARY, amount_paise: null, target: { type: "billing", id: U }, href: "/app/tenants/T/settings?section=plan" });
    render(
      <NeedsProvider initial={[{ ...card, key: `voice_credits-${U}` }]} waiting={1}>
        <NeedsYou words={WORDS} role="owner" actions={fakeActions()} now={NOW} lang="en" compact={false} />
      </NeedsProvider>,
    );
    const a = screen.getByRole("article", { name: /Voice credits/ });
    expect(within(a).getByText(SUMMARY)).toBeInTheDocument();
    expect(within(a).getByText("Balance", { selector: "span, p" })).toBeInTheDocument();
    expect(within(a).getByRole("link", { name: /Top up/ })).toHaveAttribute("href", "/app/tenants/T/settings?section=plan");
  });
});
