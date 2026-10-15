import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

import type { CalcOut } from "@contracts";

import { CALC_JSON, ITEM, ITEM_BARE_JSON, REJECTED_CALC_JSON, SITE } from "@/lib/api/materials-fixtures";

import { QuoteBuilder, type BuilderActions } from "./QuoteBuilder";
import { BASE, WORDS } from "./mat-test-kit";

const QUOTE_ID = "77777777-7777-4777-8777-777777777777";
const LINES = [{ lineNo: 1, title: "paver block", measure: "1,000 sq ft", area: { areaX100: 100000, areaUnit: "sq_ft" as const } }];
const ITEMS = [{ id: ITEM, name: "Paver block 80 mm grey", unit: "sq_ft", priceText: "₹65 per sq ft", missing: [] }, { id: ITEM_BARE_JSON.id, name: "Kerb stone", unit: "piece", priceText: null, missing: ["price"] }];

function actions(over: Partial<BuilderActions> = {}): BuilderActions & { preview: ReturnType<typeof vi.fn>; draft: ReturnType<typeof vi.fn> } {
  return {
    preview: vi.fn(async () => ({ ok: true as const, result: CALC_JSON as unknown as CalcOut, databaseAgrees: true, validUntil: "2026-10-21" })),
    draft: vi.fn(async () => ({ ok: true as const, quoteId: QUOTE_ID })),
    ...over,
  } as never;
}
function show(a = actions(), over: Partial<React.ComponentProps<typeof QuoteBuilder>> = {}) {
  render(<QuoteBuilder base={BASE} requirementId="66666666-6666-4666-8666-666666666666" newQuoteId={QUOTE_ID} lines={LINES} items={ITEMS} sites={[{ id: SITE, label: "Kukatpally villa, Hyderabad" }]} words={WORDS} actions={a} {...over} />);
  return a;
}
const pick = (id: string) => fireEvent.change(screen.getByLabelText("Product for this line"), { target: { value: id } });
const go = (name: string | RegExp) => act(async () => void fireEvent.click(screen.getByRole("button", { name })));
beforeEach(() => push.mockClear());

describe("making a quote from a requirement", () => {
  it("asks for a product on every line before it will show figures", () => {
    show(actions(), { items: [ITEMS[0], { ...ITEMS[0], id: "a3a3a3a3-a3a3-4a3a-8a3a-a3a3a3a3a3a3", name: "Paver block 60 mm red" }] });
    expect(screen.getByRole("button", { name: "Show the figures" })).toBeDisabled();
    expect(screen.getByText("Choose a product for every line first.")).toBeInTheDocument();
    pick(ITEM);
    expect(screen.getByRole("button", { name: "Show the figures" })).toBeEnabled();
  });
  it("shows the engine's figures: pieces, pallets, trips, GST and the total, and says nothing is saved yet", async () => {
    const a = show();
    pick(ITEM);
    fireEvent.change(screen.getByLabelText("Delivery site"), { target: { value: SITE } });
    await go("Show the figures");
    expect(a.preview).toHaveBeenCalledWith([{ line_no: 1, item_id: ITEM }], SITE);
    const figures = screen.getByRole("heading", { name: "The figures" }).closest("section") as HTMLElement;
    expect(within(figures).getByText(/4,725 pieces/)).toBeInTheDocument();
    expect(within(figures).getByText(/10 pallets/)).toBeInTheDocument();
    expect(within(figures).getByText("Transport (2 trips)")).toBeInTheDocument();
    expect(within(figures).getByText("₹88,795.00")).toBeInTheDocument();
    expect(within(figures).getAllByText("₹44,397.50")).toHaveLength(2);
    expect(screen.getByText(/Nothing is saved yet/)).toBeInTheDocument();
    expect(a.draft).not.toHaveBeenCalled();
  });
  it("changing a pick throws the shown figures away", async () => {
    show();
    pick(ITEM);
    await go("Show the figures");
    expect(screen.getByRole("heading", { name: "The figures" })).toBeInTheDocument();
    pick(ITEM_BARE_JSON.id);
    expect(screen.queryByRole("heading", { name: "The figures" })).toBeNull();
  });
  it("saves the previewed figures as a draft with the page's quote id, then opens the quote", async () => {
    const a = show();
    pick(ITEM);
    await go("Show the figures");
    await go("Save as a draft");
    expect(a.draft).toHaveBeenCalledWith(QUOTE_ID, [{ line_no: 1, item_id: ITEM }], null);
    expect(push).toHaveBeenCalledWith(`${BASE}/quotes/${QUOTE_ID}?made=1`);
  });
  it("will not save when the database and the calculator differ", async () => {
    show(actions({ preview: vi.fn(async () => ({ ok: true as const, result: CALC_JSON as unknown as CalcOut, databaseAgrees: false, validUntil: "x" })) } as never));
    pick(ITEM);
    await go("Show the figures");
    expect(screen.getByText(/differ on these figures/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save as a draft" })).toBeDisabled();
  });
  it("says in words why a calculation was refused, with a link to the Security page for the second factor", async () => {
    show(actions({ preview: vi.fn(async () => ({ ok: false as const, error: "The customer wants laying, but your laying rate is not set.", mfa: true })) } as never));
    pick(ITEM);
    await go("Show the figures");
    expect(screen.getByRole("alert")).toHaveTextContent("laying rate is not set");
    expect(screen.getByRole("link", { name: /Security/ })).toHaveAttribute("href", "/app/security");
  });
  it("a rejected calculation that reaches the screen shows no number", async () => {
    show(actions({ preview: vi.fn(async () => ({ ok: true as const, result: REJECTED_CALC_JSON as unknown as CalcOut, databaseAgrees: true, validUntil: "x" })) } as never));
    pick(ITEM);
    await go("Show the figures");
    expect(screen.getByRole("alert")).toHaveTextContent("cannot be worked out");
    expect(document.querySelector("[data-part=figures]")).toBeNull();
  });
  it("warns that a product lacks a figure, and points to its edit page", () => {
    show();
    pick(ITEM_BARE_JSON.id);
    expect(screen.getByRole("note")).toHaveTextContent("The price");
    expect(screen.getByRole("link", { name: "Change this product" })).toHaveAttribute("href", `${BASE}/materials/${ITEM_BARE_JSON.id}/edit`);
  });
  it("with no product at all it says so and offers to add one", () => {
    show(actions(), { items: [] });
    expect(screen.getByText(/no product to quote/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add a product" })).toBeInTheDocument();
  });
  it("one quotable product on one line is chosen already", () => {
    show(actions(), { items: [ITEMS[0]] });
    expect(screen.getByRole("button", { name: "Show the figures" })).toBeEnabled();
  });
});
