import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { wordsFor } from "@/i18n/app-words";
import { parseLowStock } from "@/lib/api/catalogue";

import { LowStock } from "./LowStock";

/** app v4 part 6: Low stock in the catalogue, "Red Kanchi silk: 2 left, about 3 asked this week". */
const W = wordsFor("en", ["ls."]);
const BASE = "/app/tenants/t";
const ID1 = "ca000000-0000-4000-8000-0000000000e1";
const ID2 = "ca000000-0000-4000-8000-0000000000e2";
const data = parseLowStock({ items: [{ id: ID1, name: "Red Kanchi silk", stock_status: "in_stock", quantity: 2, asked_this_week: 3, asked_is_approximate: true }, { id: ID2, name: "Cotton daily wear", stock_status: "few_left", quantity: null, asked_this_week: 0 }], counts_available: true });
afterEach(cleanup);
const row = (id: string) => within(document.querySelector(`[data-item="${id}"]`) as HTMLElement);

describe("Low stock (app v4)", () => {
  it("says how many are left and how many asked, or only \"Few left\"; each name opens the saree", () => {
    render(<LowStock items={data.items} countsAvailable canCount={false} base={BASE} words={W} count={vi.fn()} />);
    expect(row(ID1).getByText("2 left")).toBeInTheDocument();
    expect(row(ID1).getByText("about 3 asked this week")).toBeInTheDocument();
    expect(row(ID1).getByRole("link", { name: "Red Kanchi silk" })).toHaveAttribute("href", `${BASE}/catalogue/${ID1}`);
    expect(row(ID2).getByText("Few left")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Set the count" })).toBeNull(); // Sales and Viewers cannot count
  });
  it("draws nothing when nothing is low", () => {
    render(<LowStock items={[]} countsAvailable canCount base={BASE} words={W} count={vi.fn()} />);
    expect(document.querySelector('[data-part="low-stock"]')).toBeNull();
  });
  it("the Owner sets the count (a whole number only), or stops counting; a refusal is said in words", async () => {
    const count = vi.fn().mockResolvedValueOnce({ ok: false, error: "forbidden" }).mockResolvedValueOnce({ ok: true, quantity: 5 }).mockResolvedValueOnce({ ok: true, quantity: null });
    render(<LowStock items={data.items} countsAvailable canCount base={BASE} words={W} count={count} />);
    fireEvent.click(row(ID1).getByRole("button", { name: "Set the count" }));
    const box = row(ID1).getByLabelText("How many are left");
    expect(box).toHaveValue("2");
    fireEvent.change(box, { target: { value: "1.5" } });
    fireEvent.click(row(ID1).getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Type a whole number");
    expect(count).not.toHaveBeenCalled();
    fireEvent.change(box, { target: { value: "5" } });
    fireEvent.click(row(ID1).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Only the owner or an admin can change the count."));
    expect(count).toHaveBeenLastCalledWith(ID1, 5);
    fireEvent.click(await row(ID1).findByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved."));
    expect(refresh).toHaveBeenCalled();
    fireEvent.click(row(ID1).getByRole("button", { name: "Set the count" }));
    fireEvent.click(row(ID1).getByRole("button", { name: "Stop counting" }));
    await waitFor(() => expect(count).toHaveBeenLastCalledWith(ID1, null));
  });
  it("an API that cannot keep a count (counts_available false) offers no editor", () => {
    render(<LowStock items={data.items} countsAvailable={false} canCount base={BASE} words={W} count={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Set the count" })).toBeNull();
  });
});
