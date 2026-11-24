import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appDict } from "@/i18n/app";
import { badgesOf } from "./catalogue-logic";
import { UndoPrice } from "./UndoPrice";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
afterEach(() => {
  cleanup();
  refresh.mockClear();
});
const words = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("catalogue.")));

describe("Undo price change (the Owner, 30 days)", () => {
  it("puts the price back, says so in one line and reads the page again", async () => {
    const undo = vi.fn(async () => ({ ok: true as const }));
    render(<UndoPrice undo={undo} words={words} />);
    fireEvent.click(screen.getByRole("button", { name: "Undo price change" }));
    expect(await screen.findByText("The earlier price is back.")).toBeInTheDocument();
    expect(undo).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Undo price change" })).toBeNull(); // hidden until another price change happens
  });
  it("nothing to undo is one plain sentence and the button stays", async () => {
    render(<UndoPrice undo={async () => ({ ok: false as const, error: "nothing_to_undo" as const })} words={words} />);
    fireEvent.click(screen.getByRole("button", { name: "Undo price change" }));
    expect(await screen.findByText("There is no price change to undo.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Undo price change" })).toBeEnabled());
  });
});

describe("Out of stock", () => {
  it("is a badge of its own on a card, apart from few left and made to order", () => {
    expect(badgesOf({ active: true, stock_status: "out_of_stock" })).toEqual(["out_of_stock"]);
    expect(badgesOf({ active: false, stock_status: "few_left" })).toEqual(["inactive", "few_left"]);
  });
});
