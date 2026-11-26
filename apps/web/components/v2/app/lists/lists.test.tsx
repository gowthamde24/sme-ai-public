import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appDict } from "@/i18n/app";
import type { Column, RowPage, SellList } from "@/lib/lists/types";

import { AddListForm } from "./AddListForm";
import { ColumnsEditor } from "./ColumnsEditor";
import { ListCards } from "./ListCards";
import { ListSettings } from "./ListSettings";
import { ListView } from "./ListView";
import { StarterLists } from "./StarterLists";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
afterEach(() => {
  cleanup();
  push.mockClear();
});

const words = appDict("en");
const col = (key: string, label: string, type: Column["type"], extra: Partial<Column> = {}): Column => ({ key, label, type, choices: [], role: null, billingPeriod: null, quoteDefault: false, ...extra });
const LIST: SellList = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Dress materials",
  kind: "products",
  isMain: false,
  rowCount: 3,
  columns: [col("name", "Name", "text"), col("lining", "Lining", "choice", { choices: ["Cotton", "Satin"] }), col("retail", "Retail price", "rupees", { role: "price", billingPeriod: "one_time", quoteDefault: true }), col("fee", "Monthly fee", "rupees", { role: "price", billingPeriod: "per_month" })],
};
const ROWS: RowPage = { items: [
  { id: "r1", name: "Cotton blue", cells: { lining: "Cotton", retail: 145000, fee: 29900 }, active: true },
  { id: "r2", name: "Georgette maroon", cells: { lining: "Satin", retail: null, fee: null }, active: true },
  { id: "r3", name: "Chanderi mustard", cells: { lining: "Cotton", retail: 220000, fee: null }, active: true },
], nextCursor: null };
const acts = () => ({ load: vi.fn(async () => ({ ok: true as const, data: ROWS })), save: vi.fn(async (id: string, input: { name: string }) => ({ ok: true as const, data: { id, name: input.name, cells: {}, active: true } })), remove: vi.fn(async () => ({ ok: true as const, data: true as const })) });

describe("lists: the cards", () => {
  it("one boxed card per list with its kind, name and items, Add a list for an owner, and how many of the allowed lists are used", () => {
    render(<ListCards lists={[LIST]} words={words} base="/b" canAdd />);
    const card = document.querySelector(`[data-list="${LIST.id}"]`) as HTMLElement;
    expect(card).toHaveAttribute("href", `/b/lists/${LIST.id}`);
    expect(within(card).getByText("Products")).toBeInTheDocument();
    expect(within(card).getByText("3 items")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add a list" })).toHaveAttribute("href", "/b/lists/new");
    expect(screen.getByText("1 of 10 lists used.")).toBeInTheDocument();
  });
  it("no Add a list for someone who cannot add", () => {
    render(<ListCards lists={[]} words={words} base="/b" canAdd={false} />);
    expect(screen.queryByRole("link", { name: "Add a list" })).toBeNull();
  });
});

describe("lists: Add a list", () => {
  it("ten kinds as radio tiles, a name, and the list is created once with the id minted when the page opened", async () => {
    const create = vi.fn(async (i: { id: string; name: string; kind: string }) => ({ ok: true as const, data: { ...LIST, id: "22222222-2222-4222-8222-222222222222", name: i.name } }));
    render(<AddListForm words={words} base="/b" create={create as never} />);
    expect(screen.getAllByRole("radio")).toHaveLength(10);
    fireEvent.click(screen.getByRole("radio", { name: /Digital products/ }));
    expect(screen.getByRole("radio", { name: /Digital products/ })).toHaveAttribute("aria-checked", "true");
    fireEvent.change(screen.getByLabelText("List name"), { target: { value: "Ebooks" } });
    fireEvent.click(screen.getByRole("button", { name: "Create the list" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0][0]).toMatchObject({ name: "Ebooks", kind: "digital" });
    expect(create.mock.calls[0][0].id).toMatch(/^[0-9a-f-]{36}$/);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/b/lists/22222222-2222-4222-8222-222222222222?new=1"));
  });
  it("a refusal is one plain sentence", async () => {
    const create = vi.fn(async () => ({ ok: false as const, error: "list_limit" as const }));
    render(<AddListForm words={words} base="/b" create={create as never} />);
    fireEvent.change(screen.getByLabelText("List name"), { target: { value: "X" } });
    fireEvent.click(screen.getByRole("button", { name: "Create the list" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("You have all the lists your plan allows");
  });
});

describe("lists: one list", () => {
  it("draws the rows with prices in rupees and their billing period, and 'Add price' for a missing price (an owner)", () => {
    render(<ListView list={LIST} initial={ROWS} owner canEdit words={words} base="/b" actions={acts()} />);
    const r1 = document.querySelector('[data-row="r1"]') as HTMLElement;
    expect(within(r1).getByText("₹1,450")).toBeInTheDocument();
    expect(within(r1).getByText("₹299 per month")).toBeInTheDocument();
    expect(within(document.querySelector('[data-row="r2"]') as HTMLElement).getAllByText("Add price").length).toBeGreaterThan(0);
  });
  it("an admin sees 'No price' and cannot edit a price: the rupee field is read-only with the reason", () => {
    render(<ListView list={LIST} initial={ROWS} owner={false} canEdit words={words} base="/b" actions={acts()} />);
    expect(within(document.querySelector('[data-row="r2"]') as HTMLElement).getAllByText("No price").length).toBeGreaterThan(0);
    fireEvent.click(within(document.querySelector('[data-row="r1"]') as HTMLElement).getByRole("button"));
    expect(screen.getByLabelText(/Retail price/)).toBeDisabled();
    expect(screen.getAllByText("Only the Owner can change prices.").length).toBeGreaterThan(0);
  });
  it("a row of filter chips for each choice column (a dropdown past 12 words) and a Sort by the quoted price", () => {
    render(<ListView list={LIST} initial={ROWS} owner canEdit words={words} base="/b" actions={acts()} />);
    fireEvent.click(within(screen.getByRole("group", { name: "Lining" })).getByRole("button", { name: "Satin" }));
    expect(document.querySelectorAll("[data-row]")).toHaveLength(1);
    fireEvent.click(within(screen.getByRole("group", { name: "Lining" })).getByRole("button", { name: /all/i }));
    fireEvent.change(screen.getByLabelText("Sort"), { target: { value: "price" } });
    const order = Array.from(document.querySelectorAll("[data-row]")).map((e) => e.getAttribute("data-row"));
    expect(order).toEqual(["r1", "r3", "r2"]);
  });
  it("Add an item opens an editor; the price is typed in rupees and goes on as typed text for the action to turn into paise", async () => {
    const a = acts();
    render(<ListView list={LIST} initial={{ items: [], nextCursor: null }} owner canEdit words={words} base="/b" actions={a} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add an item" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "New one" } });
    fireEvent.change(screen.getByLabelText(/Retail price/), { target: { value: "1,450" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(a.save).toHaveBeenCalled());
    const [rowId, input, rupeeKeys] = a.save.mock.calls[0] as unknown as [string, { name: string; cells: Record<string, unknown> }, string[]];
    expect(rowId).toMatch(/^[0-9a-f-]{36}$/);
    expect(input).toMatchObject({ name: "New one", cells: { retail: "1,450" } });
    expect(rupeeKeys).toEqual(["retail", "fee"]);
    await waitFor(() => expect(screen.getByText("New one")).toBeInTheDocument());
  });
  it("a price that is not an amount is refused on the spot with the plain sentence; nothing is sent", () => {
    const a = acts();
    render(<ListView list={LIST} initial={{ items: [], nextCursor: null }} owner canEdit words={words} base="/b" actions={a} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add an item" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "X" } });
    fireEvent.change(screen.getByLabelText(/Retail price/), { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Type the price as an amount in rupees");
    expect(a.save).not.toHaveBeenCalled();
  });
});

describe("lists: Edit columns", () => {
  const saveOk = () => vi.fn(async () => ({ ok: true as const, data: LIST }));
  it("the Name column is fixed; the others move up and down and can be removed; Save sends the whole ordered set once", async () => {
    const save = saveOk();
    render(<ColumnsEditor list={LIST} words={words} back="/back" save={save} />);
    expect(screen.getAllByLabelText("Column name")[0]).toBeDisabled();
    fireEvent.click(within(document.querySelector('[data-column="retail"]') as HTMLElement).getByRole("button", { name: "Move up" }));
    fireEvent.click(within(document.querySelector('[data-column="fee"]') as HTMLElement).getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Save columns" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const [sent, confirm] = save.mock.calls[0] as unknown as [{ key: string; role: string | null; quoteDefault: boolean }[], boolean];
    expect(sent.map((c) => c.key)).toEqual(["name", "retail", "lining"]);
    expect(sent[1]).toMatchObject({ role: "price", billingPeriod: "one_time", quoteDefault: true });
    expect(confirm).toBe(false);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/back"));
  });
  it("a column with information asks 'Hide it?' and is sent again with the person's yes", async () => {
    const save = vi.fn().mockResolvedValueOnce({ ok: false, error: "column_has_data" }).mockResolvedValueOnce({ ok: true, data: LIST });
    render(<ColumnsEditor list={LIST} words={words} back="/back" save={save as never} />);
    fireEvent.click(within(document.querySelector('[data-column="lining"]') as HTMLElement).getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Save columns" }));
    expect(await screen.findByText(/Hide it\? The information is kept for 30 days/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide it and save" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1][1]).toBe(true);
  });
  it("a new column starts as Text with no meaning and the editor stops at 12", () => {
    render(<ColumnsEditor list={LIST} words={words} back="/back" save={saveOk() as never} />);
    for (let i = 0; i < 12; i += 1) {
      const add = screen.getByRole("button", { name: "+ Add a column" });
      if ((add as HTMLButtonElement).disabled) break;
      fireEvent.click(add);
    }
    expect(screen.getAllByLabelText("Column name")).toHaveLength(12);
    expect(screen.getByRole("button", { name: "+ Add a column" })).toBeDisabled();
  });
});

describe("What you sell for a textile owner (26 Nov 2026)", () => {
  it("a built-in list (the saree catalogue) leads to the screen where it is edited, not to a rows page; it does not count against the lists used", () => {
    const sarees: SellList = { ...LIST, id: "22222222-2222-4222-8222-222222222222", name: "Sarees", builtin: "catalogue", editIn: "catalogue" };
    render(<ListCards lists={[sarees, LIST]} words={words} base="/app/tenants/t/what-you-sell" canAdd />);
    const card = document.querySelector(`[data-list="${sarees.id}"]`) as HTMLElement;
    expect(card).toHaveAttribute("href", "/app/tenants/t/catalogue");
    expect(card).toHaveTextContent("Edit in the catalogue");
    expect(screen.getByText(/1 of 10/)).toBeInTheDocument();
  });
  it("'Add starter lists': one plain sentence of what it makes, nothing made until the button, then the page reads the lists again", async () => {
    const make = vi.fn(async () => ({ ok: true as const, data: true as const }));
    render(<StarterLists words={words} make={make} />);
    expect(screen.getByText(/Sarees, Dress materials, Blouses, Dupattas, Fabric by the metre, and Stitching and alterations/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing is made until you press the button/)).toBeInTheDocument();
    expect(make).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Add the six lists" }));
    await waitFor(() => expect(make).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
  it("a refusal of the starters is one plain sentence and the button comes back", async () => {
    render(<StarterLists words={words} make={vi.fn(async () => ({ ok: false as const, error: "list_limit" as const }))} />);
    fireEvent.click(screen.getByRole("button", { name: "Add the six lists" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(words["wls.err.list_limit"]);
    expect(screen.getByRole("button", { name: "Add the six lists" })).toBeEnabled();
  });
  it("List settings: rename saves the new name; delete asks first (what goes with it) and only the second press deletes", async () => {
    const rename = vi.fn(async (name: string) => ({ ok: true as const, data: { ...LIST, name } }));
    const remove = vi.fn(async () => ({ ok: true as const, data: true as const }));
    render(<ListSettings list={LIST} words={words} base="/b" rename={rename} remove={remove} />);
    fireEvent.change(screen.getByLabelText("Name of the list"), { target: { value: "Dress fabrics" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(rename).toHaveBeenCalledWith("Dress fabrics"));
    fireEvent.click(screen.getByRole("button", { name: "Delete this list" }));
    expect(screen.getByRole("alert")).toHaveTextContent('Delete "Dress materials" and its 3 items? This cannot be undone.');
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete it" }));
    await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/b"));
  });
  const CATEGORISED: SellList = { ...LIST, columns: [col("name", "Name", "text"), col("category", "Category", "choice", { choices: ["Silk", "Cotton", "Bridal"], role: "category" }), col("retail", "Price", "rupees", { role: "price", billingPeriod: "one_time", quoteDefault: true })] };
  const CROWS: RowPage = { items: [
    { id: "c1", name: "Kanchi bridal", cells: { category: "Bridal", retail: 2450000 }, active: true },
    { id: "c2", name: "Mysore silk", cells: { category: "Silk", retail: 740000 }, active: true },
    { id: "c3", name: "Plain thing", cells: { category: null, retail: 100000 }, active: true },
    { id: "c4", name: "Uppada cotton", cells: { category: "Cotton", retail: 410000 }, active: true },
  ], nextCursor: null };
  it("the Category column is a row of filter chips (All first), a pressed chip filters, and the chips are buttons with aria-pressed", () => {
    render(<ListView list={CATEGORISED} initial={CROWS} owner canEdit words={words} base="/b" actions={acts() as never} />);
    const chips = screen.getByRole("group", { name: "Category" });
    expect([...chips.querySelectorAll("button")].map((b) => b.textContent)).toEqual([words["wls.all"].replace("{name}", "Category"), "Silk", "Cotton", "Bridal"]);
    expect(within(chips).getByRole("button", { name: words["wls.all"].replace("{name}", "Category") })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(chips).getByRole("button", { name: "Silk" }));
    expect(within(chips).getByRole("button", { name: "Silk" })).toHaveAttribute("aria-pressed", "true");
    expect([...document.querySelectorAll("[data-row]")].map((r) => r.textContent)).toEqual([expect.stringContaining("Mysore silk")]);
  });
  it("'Group by Category' puts the items under the column's words in their order, those with no category last", () => {
    render(<ListView list={CATEGORISED} initial={CROWS} owner canEdit words={words} base="/b" actions={acts() as never} />);
    fireEvent.click(screen.getByLabelText("Group by Category"));
    expect([...document.querySelectorAll("[data-group]")].map((g) => g.getAttribute("data-group"))).toEqual(["Silk", "Cotton", "Bridal", ""]);
    expect(document.querySelector('[data-group=""]')).toHaveTextContent("No category");
    expect([...document.querySelectorAll("[data-row]")].map((r) => r.getAttribute("data-row"))).toEqual(["c2", "c4", "c1", "c3"]);
  });
  it("'Add a column' offers Category as a named choice column (role category, the owner types his own words), once", () => {
    const save = vi.fn(async (cols: unknown) => ({ ok: true as const, data: { ...LIST, columns: cols as never } }));
    render(<ColumnsEditor list={LIST} words={words} back="/b" save={save as never} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add a Category" }));
    expect(screen.queryByRole("button", { name: "+ Add a Category" })).toBeNull(); // one Category column per list
    const labels = screen.getAllByLabelText("Column name") as HTMLInputElement[];
    expect(labels[labels.length - 1]).toHaveValue("Category");
    expect(screen.getAllByLabelText("The choices, separated by commas").length).toBeGreaterThan(0);
  });
});

