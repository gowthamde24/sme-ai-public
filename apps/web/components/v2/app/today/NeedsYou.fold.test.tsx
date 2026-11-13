import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));
vi.mock("../visits/LazySlotPicker", async () => ({ SlotPicker: (await import("../visits/SlotPicker")).SlotPicker }));

import { NeedsYou, foldQuotes } from "./NeedsYou";
import { NeedsProvider } from "./needs-store";
import { NOW, WORDS, call, classic, fakeActions, outbox } from "./today-test-kit";
import type { NeedsCard } from "./types";

afterEach(cleanup);

const base = outbox().type === "outbox" ? (outbox() as Extract<NeedsCard, { type: "outbox" }>) : null;
const reply = (customer: string | null, text: string): NeedsCard => ({ ...(base as Extract<NeedsCard, { type: "outbox" }>), key: "outbox_approval-r1", customer, message: { ...(base!.message as NonNullable<typeof base>["message"] & object), text, flags: [] } });
const quote = (customer: string, paise: number, over: Record<string, unknown> = {}): NeedsCard => classic({ customer, amount_paise: paise, href: "/app/tenants/T/enquiries/E1", ...over });

describe("every number once: a reply that carries a quote and the quote's own row are one row (design system v6)", () => {
  it("folds the quote of the same customer and the same amount into the reply row", () => {
    const cards = [reply("Padmaja Naidu", "Dear Padmaja, your quote is ₹24,500. Shall I send it?"), quote("Padmaja Naidu", 2_450_000), call()];
    const f = foldQuotes(cards);
    expect([...f.hide]).toEqual([cards[1].key]);
    expect(f.href.get("outbox_approval-r1")).toBe("/app/tenants/T/enquiries/E1");
  });
  it("does not fold when the name or the amount differs, or the reply has no amount (it cannot be told they are the same)", () => {
    expect(foldQuotes([reply("Padmaja Naidu", "Your quote is ₹24,500."), quote("Someone Else", 2_450_000)]).hide.size).toBe(0);
    expect(foldQuotes([reply("Padmaja Naidu", "Your quote is ₹24,500."), quote("Padmaja Naidu", 2_000_000)]).hide.size).toBe(0);
    expect(foldQuotes([reply("Padmaja Naidu", "Thank you, see you soon."), quote("Padmaja Naidu", 2_450_000)]).hide.size).toBe(0);
    expect(foldQuotes([reply(null, "Your quote is ₹24,500."), quote("Padmaja Naidu", 2_450_000)]).hide.size).toBe(0);
  });
  it("one quote folds into one reply only", () => {
    const f = foldQuotes([reply("Padmaja Naidu", "Quote ₹24,500."), { ...reply("Padmaja Naidu", "Quote ₹24,500."), key: "outbox_approval-r2" }, quote("Padmaja Naidu", 2_450_000)]);
    expect(f.hide.size).toBe(1);
    expect(f.href.size).toBe(1);
  });

  const board = (cards: NeedsCard[], design: boolean) =>
    render(
      <NeedsProvider initial={cards} waiting={cards.length}>
        <NeedsYou words={WORDS} role="owner" actions={fakeActions()} now={NOW} lang="en" design={design} />
      </NeedsProvider>,
    );
  it("draws ONE row for the pair, with a link to the quote, and the badge counts the rows that are drawn", () => {
    board([reply("Padmaja Naidu", "Your quote is ₹24,500."), quote("Padmaja Naidu", 2_450_000), call()], true);
    expect(document.querySelectorAll("[data-needs-row]")).toHaveLength(2);
    expect(screen.getAllByText("₹24,500")).toHaveLength(1);
    const row = document.querySelector('[data-needs-row="outbox_approval-r1"]') as HTMLElement;
    expect(within(row).getByRole("link", { name: "Open the quote" })).toHaveAttribute("href", "/app/tenants/T/enquiries/E1");
    expect(document.querySelector("[data-count]")).toHaveAttribute("data-count", "2");
  });
  it("without the design system both rows are drawn as before", () => {
    board([reply("Padmaja Naidu", "Your quote is ₹24,500."), quote("Padmaja Naidu", 2_450_000), call()], false);
    expect(document.querySelectorAll("[data-needs-row]").length).toBe(3);
    expect(screen.queryByRole("link", { name: "Open the quote" })).toBeNull();
    expect(document.querySelector("[data-count]")).toHaveAttribute("data-count", "3");
  });
});
