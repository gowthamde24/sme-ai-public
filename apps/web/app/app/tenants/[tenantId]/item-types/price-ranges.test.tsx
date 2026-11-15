import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { wordsFor } from "@/i18n/app-words";
import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { parseItemTypes } from "@/lib/api/item-types";
import { TYPE_A_JSON, TYPE_B_JSON, TYPE_C_JSON } from "@/lib/api/quotes-fixtures";
import { redirectMock, redirectTarget } from "@/test/helpers";

const fetchItemTypes = vi.fn();

vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to), notFound: () => { throw new Error("not found"); } }));
vi.mock("@/lib/api/item-types", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/item-types")>()), fetchItemTypes: (...a: unknown[]) => fetchItemTypes(...a) }));
vi.mock("./item-types-actions", () => ({ addItemTypeAction: vi.fn(async () => undefined), saveItemTypeAction: vi.fn(async () => undefined) }));

import { PriceRanges } from "./price-ranges";

const T = "22222222-2222-4222-8222-222222222222";
const WORDS = wordsFor("en", ["it.", "qp."]);

beforeEach(() => {
  vi.clearAllMocks();
  fetchItemTypes.mockResolvedValue(parseItemTypes([TYPE_B_JSON, TYPE_C_JSON, TYPE_A_JSON]));
});

/** The data rows of the price ranges table, in the order shown (the header row and the edit-form rows are not among them). */
const typeRows = () => screen.getAllByRole("rowheader").map((h) => h.closest("tr") as HTMLElement);

async function show(role: string, aal = "aal2") {
  render(await PriceRanges({ accessToken: "tok", tenantId: T, role, secondFactorMissing: aal !== "aal2", words: WORDS }));
}

describe("the Price ranges section (the item types, under the price list)", () => {
  it("is a section with its own heading and one plain line: a quote outside the range only warns", async () => {
    await show("owner");
    expect(screen.getByRole("heading", { level: 2, name: "Price ranges" })).toBeInTheDocument();
    expect(screen.getByText("A quote outside this range shows a warning; it never blocks the quote.")).toBeInTheDocument();
    expect(document.getElementById("price-ranges")).not.toBeNull(); // the anchor the old address and the assistant go to
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });
  it("reads the list with the user's own token", async () => {
    await show("owner");
    expect(fetchItemTypes).toHaveBeenCalledWith("tok", T);
  });
  it("lists every item type in the owner's order with its name, code, switch and prices in rupees", async () => {
    await show("owner");
    const items = typeRows().map((tr) => tr.textContent ?? "");
    expect(items).toHaveLength(3);
    expect(items[0]).toContain("Type C (not sold)");
    expect(items[1]).toContain("Type A");
    expect(items[2]).toContain("Type B");
    expect(items[0]).toContain("No, switched off");
    expect(items[2]).toContain("₹500.00");
    expect(items[2]).toContain("₹4,000.00");
    expect(items[1]).toContain("none");
  });
  it("shows the types as one table with a column for each fact, and each cell says which fact it is", async () => {
    await show("owner");
    const table = screen.getByRole("table", { name: "Item types, in order" });
    const heads = within(table).getAllByRole("columnheader").map((h) => h.textContent);
    expect(heads).toEqual(["Name", "Code", "Can be used", "Position", "Lowest price", "Highest price", "Edit"]);
    const b = typeRows()[2];
    expect(within(b).getByRole("rowheader")).toHaveTextContent("Type B");
    expect(within(b).getAllByRole("cell").map((c) => c.getAttribute("data-label"))).toEqual(["Code", "Can be used", "Position", "Lowest price", "Highest price", null]);
    expect(within(b).getAllByRole("cell").slice(0, 5).map((c) => c.textContent)).toEqual(["B", "Yes", "2", "₹500.00", "₹4,000.00"]);
  });
  it("puts each edit control in the row of its type, and its form in the row under it", async () => {
    await show("owner");
    const [c, a] = typeRows();
    expect(within(c).getByText("Edit Type C (not sold)")).toBeInTheDocument();
    expect(within(a).getByText("Edit Type A")).toBeInTheDocument();
    const form = (a.nextElementSibling as HTMLElement).querySelector("form");
    expect(form).not.toBeNull();
    expect(within(form as HTMLElement).getByLabelText("Name")).toHaveValue("Type A");
  });
  it.each(["owner", "admin"])("a %s with the authenticator app gets the add form and an edit control for every type", async (role) => {
    await show(role);
    fireEvent.click(screen.getByRole("button", { name: "Add an item type" })); // the add form opens in place
    expect(screen.getByRole("heading", { name: "Add an item type" })).toBeInTheDocument();
    expect(screen.getAllByText(/^Edit Type/)).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: "Save changes" })).toHaveLength(3);
    expect(screen.getByText(/typed once and can never be changed/)).toBeInTheDocument();
  });
  it.each(["owner", "admin"])("a %s without the authenticator app sees the list, one sentence with the link, and NO control", async (role) => {
    await show(role, "aal1");
    expect(typeRows()).toHaveLength(3);
    expect(screen.queryByRole("columnheader", { name: "Edit" })).toBeNull();
    expect(screen.getByText(/needs your two-step code/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Security page/ })).toHaveAttribute("href", "/app/security");
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Add an item type" })).toBeNull();
  });
  it("a sales user reads the list and is offered no edit control at all", async () => {
    await show("sales");
    expect(typeRows()).toHaveLength(3);
    expect(screen.getAllByRole("row")).toHaveLength(4); // the header and the three types: no edit-form row either
    expect(screen.queryByRole("columnheader", { name: "Edit" })).toBeNull();
    expect(document.querySelector("details, summary, form, .edit-row")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByText(/^Edit /)).toBeNull();
    expect(screen.queryByRole("heading", { name: "Add an item type" })).toBeNull();
    expect(screen.getByText("Only an owner or an admin can add or change item types.")).toBeInTheDocument();
  });
  it("an empty workspace says so, and offers the first add to a writer only", async () => {
    fetchItemTypes.mockResolvedValue([]);
    await show("owner");
    expect(screen.getByText(/No item types yet\. Add the first one below\./)).toBeInTheDocument();
    document.body.innerHTML = "";
    await show("sales");
    expect(screen.getByText("No item types yet.")).toBeInTheDocument();
  });
  it("uses no jargon on the page", async () => {
    await show("owner");
    expect(document.body.textContent).not.toMatch(/aal2|SKU|basis point|\bbps\b|paise/i);
  });
  it("a list that cannot be read says so in one sentence in its place; an expired session goes to sign-in", async () => {
    fetchItemTypes.mockRejectedValue(new ApiRequestError(503, "quotes_unavailable", "x"));
    await show("owner");
    expect(screen.getByRole("alert")).toHaveTextContent("Price ranges are not available right now.");
    expect(screen.queryByRole("table")).toBeNull();
    fetchItemTypes.mockRejectedValue(new ApiAuthError("expired"));
    expect(await redirectTarget(async () => { render(await PriceRanges({ accessToken: "tok", tenantId: T, role: "owner", secondFactorMissing: false, words: WORDS })); })).toBe("/login");
  });
});
