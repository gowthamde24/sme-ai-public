import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appDict } from "@/i18n/app";
import { parseSellList } from "@/lib/api/what-you-sell";
import { wireSell } from "@/lib/sell/fixtures";
import { EMPTY, buildEntry } from "@/lib/sell/forms";
import { understand } from "@/lib/sell/say";
import { SELL_STYLES, type SellEntry, type SellForm, type SellStyle } from "@/lib/sell/types";

import { SellSection } from "./SellSection";
import type { SellActions } from "./types";

// the sheet is its own lazy chunk on a real page; a unit test draws it at once
vi.mock("./LazyWork", async () => {
  const { default: Work } = await import("./SellWork");
  return { loadWork: async () => undefined, LazyWork: (p: Parameters<typeof Work>[0]) => <Work {...p} /> };
});

afterEach(cleanup);
const dict = appDict("en") as Record<string, string>;
const wordsOf = (d: Record<string, string>) => Object.fromEntries(Object.entries(d).filter(([k]) => k.startsWith("jobs.sell.") || k.startsWith("catalogue.colour.")));
const words = wordsOf(dict);
const BASE = "/app/tenants/t";
const entriesOf = (s: SellStyle) => parseSellList(wireSell(s), s);

function actions(over: Partial<SellActions> = {}): SellActions {
  return {
    // the mock's save: what the page's action does in test mode (checks the form, answers the entry)
    save: vi.fn(async (style: SellStyle, id: string | null, form: SellForm[SellStyle]) => {
      const built = buildEntry(style, id ?? "5e110009-0000-4000-8000-000000000001", form, null, true);
      return built.ok ? { ok: true as const, data: { entry: built.entry, photosPath: null, note: null } } : { ok: false as const, kind: "invalid" as const, error: `refused: ${built.code}` };
    }),
    understand: vi.fn(async (style: SellStyle, text: string) => ({ ok: true as const, data: { form: understand(style, text) } })),
    readSheet: vi.fn(async (style: SellStyle) => ({ ok: true as const, data: { entries: entriesOf(style).slice(0, 2) } })),
    ...over,
  };
}
const section = (style: SellStyle, o: { actions?: SellActions | null; live?: boolean; ownerPrice?: boolean; entries?: SellEntry[]; paths?: { photos: string | null; sheet: string | null }; w?: Record<string, string> } = {}) =>
  render(<SellSection style={style} entries={o.entries ?? entriesOf(style)} words={o.w ?? words} base={BASE} actions={o.actions === undefined ? actions() : o.actions} live={o.live ?? false} ownerPrice={o.ownerPrice ?? true} paths={o.paths ?? { photos: null, sheet: null }} oldLinks={[]} />);

describe("each of the five styles draws its list in its own words", () => {
  it.each([
    ["products", "Products", "Add a product", "Kanjivaram silk saree", "₹8,500"],
    ["services", "Services", "Add a service", "Haircut", "₹200"],
    ["courses", "Courses", "Add a course", "NEET crash course", "₹24,000"],
    ["properties", "Properties", "Add a property", "2 BHK flat, Kukatpally", "₹68 lakh"],
    ["pricelist", "Price lists", "Add an item", "Cotton shirting 40s", "50 m+ ₹118"],
  ] as const)("%s", (style, title, add, first, price) => {
    section(style);
    expect(screen.getByRole("heading", { name: new RegExp(title) })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: add })).toBeInTheDocument();
    const rows = document.querySelectorAll("[data-entry]");
    expect(rows).toHaveLength(entriesOf(style).length);
    expect(rows[0].textContent).toContain(first);
    expect(rows[0].textContent).toContain(price);
    expect(document.querySelector('[data-part="what-you-sell"]')).toHaveAttribute("data-style", style);
  });
  it("an empty list says what to do, in one sentence", () => {
    section("services", { entries: [] });
    expect(screen.getByText(/Nothing here yet\. Say it, take a photo or import a sheet/)).toBeInTheDocument();
  });
  it("the three ways to fill it, each with its own words and the style's example sentence", () => {
    section("properties");
    const fill = document.querySelector('[data-part="fill"]') as HTMLElement;
    expect(within(fill).getByText("Say it")).toBeInTheDocument();
    expect(within(fill).getByText("Take photos")).toBeInTheDocument();
    expect(within(fill).getByText("Import a sheet")).toBeInTheDocument();
    expect(within(fill).getByText(/2 BHK flat in Kukatpally, 1,150 sq ft, 68 lakh, available/)).toBeInTheDocument();
  });
});

describe("who may change it", () => {
  it("Sales and Viewer read: no buttons, no tappable rows", () => {
    section("products", { actions: null });
    expect(document.querySelector('[data-part="fill"]')).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Kanjivaram silk saree")).toBeInTheDocument();
  });
  it("in a real workspace Take photos and Import a sheet go to the pages that exist (the catalogue's photo page, the price list's import); with no page they open the sheet", () => {
    section("products", { live: true, paths: { photos: "/catalogue/new", sheet: null } });
    expect(document.querySelector('[data-way="photos"]')).toHaveAttribute("href", `${BASE}/catalogue/new`);
    expect(document.querySelector('[data-way="sheet"]')?.tagName).toBe("BUTTON");
    cleanup();
    section("pricelist", { live: true, paths: { photos: null, sheet: "/price-list" } });
    expect(document.querySelector('[data-way="sheet"]')).toHaveAttribute("href", `${BASE}/price-list`);
  });
});

describe("add and change", () => {
  it("add a product: the name, the price, the colours and the stock, in two sentences; Save sends them and the new row is on top", async () => {
    const a = actions();
    section("products", { actions: a });
    fireEvent.click(screen.getByRole("button", { name: "Add a product" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a product" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Red Kanchi silk" } });
    fireEvent.change(within(dialog).getByLabelText("Price in rupees"), { target: { value: "9,000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Red" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Gold" }));
    fireEvent.change(within(dialog).getByLabelText("Stock"), { target: { value: "few_left" } });
    fireEvent.change(within(dialog).getByLabelText("How many"), { target: { value: "2" } });
    expect(within(dialog).getByText("2 colours")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Save product" }));
    await waitFor(() => expect(a.save).toHaveBeenCalledTimes(1));
    expect(a.save).toHaveBeenCalledWith("products", null, { name: "Red Kanchi silk", price: "9,000", colours: ["red", "gold"], stock: "few_left", count: "2" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect((document.querySelector("[data-entry]") as HTMLElement).textContent).toContain("Red Kanchi silk");
    expect(document.querySelectorAll("[data-entry]")).toHaveLength(5);
  });
  it("no more than four choices in the main sentences; the rest is under More choices", async () => {
    section("services");
    fireEvent.click(screen.getByRole("button", { name: "Add a service" }));
    const dialog = await screen.findByRole("dialog");
    const form = dialog.querySelector('[data-part="form"]') as HTMLElement;
    const more = form.querySelector('[data-part="more-choices"]') as HTMLElement;
    const main = [...form.querySelectorAll("input, select, textarea")].filter((el) => !more.contains(el));
    expect(main.length - 1).toBeLessThanOrEqual(4); // (the name is the field, the rest are the choices inside the sentence)
    expect(within(more).getByText("More choices")).toBeInTheDocument();
  });
  it("a row opens its sheet filled in; the change is sent with the row's own id and the list shows it", async () => {
    const a = actions();
    section("pricelist", { actions: a });
    fireEvent.click(screen.getByText("Silk blend dupatta"));
    const dialog = await screen.findByRole("dialog", { name: "Change an item" });
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Silk blend dupatta");
    expect(within(dialog).getAllByLabelText("Rate in rupees")).toHaveLength(2);
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Silk dupatta" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save item" }));
    await waitFor(() => expect(a.save).toHaveBeenCalled());
    expect(vi.mocked(a.save).mock.calls[0][1]).toBe(entriesOf("pricelist")[1].id);
    await waitFor(() => expect(screen.getByText("Silk dupatta")).toBeInTheDocument());
    expect(document.querySelectorAll("[data-entry]")).toHaveLength(3);
  });
  it("a price list can take another rate and drop one", async () => {
    section("pricelist");
    fireEvent.click(screen.getByRole("button", { name: "Add an item" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.querySelectorAll('[data-part="rate"]')).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole("button", { name: "Add a rate" }));
    expect(dialog.querySelectorAll('[data-part="rate"]')).toHaveLength(2);
    fireEvent.click(within(dialog).getAllByRole("button", { name: "Remove this rate" })[0]);
    expect(dialog.querySelectorAll('[data-part="rate"]')).toHaveLength(1);
  });
  it("a form that does not fit says why in a sentence and sends nothing", async () => {
    const a = actions();
    section("services", { actions: a });
    fireEvent.click(screen.getByRole("button", { name: "Add a service" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Save service" }));
    expect(await within(dialog).findByText("Please write a name.")).toBeInTheDocument();
    expect(a.save).not.toHaveBeenCalled();
  });
  it("what the server refuses is shown in its sentence and the sheet stays open", async () => {
    const a = actions({ save: vi.fn(async () => ({ ok: false as const, kind: "mfa" as const, error: "Saving needs your two-step code first.", mfa: true })) });
    section("products", { actions: a });
    fireEvent.click(screen.getByText("Mysore silk saree"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Save product" }));
    expect(await within(dialog).findByText("Saving needs your two-step code first.")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
  it("an Admin is told the exact price is the owner's", async () => {
    section("products", { ownerPrice: false });
    fireEvent.click(screen.getByRole("button", { name: "Add a product" }));
    expect(await screen.findByText(/Only the owner sets the exact price/)).toBeInTheDocument();
  });
  it("Escape closes the sheet and the page behind is not left locked", async () => {
    section("services");
    fireEvent.click(screen.getByRole("button", { name: "Add a service" }));
    const dialog = await screen.findByRole("dialog");
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.body.style.overflow).toBe("");
  });
});

describe("Say it, Take photos, Import a sheet: nothing is saved until Save", () => {
  it("Say it shows the I-understood card for a whole sentence, and Save sends exactly that", async () => {
    const a = actions();
    section("products", { actions: a });
    fireEvent.click(screen.getByText("Say it"));
    const dialog = await screen.findByRole("dialog", { name: "Say it" });
    fireEvent.change(within(dialog).getByLabelText("Tell me what you sell"), { target: { value: "Cotton towel, 250 rupees, blue, 10 in stock" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Show what you understood" }));
    const card = await screen.findByRole("dialog", { name: "I understood" });
    expect(within(card).getByText("Cotton towel")).toBeInTheDocument();
    expect(within(card).getByText("₹250")).toBeInTheDocument();
    expect(within(card).getByText("10 in stock")).toBeInTheDocument();
    expect(a.save).not.toHaveBeenCalled();
    fireEvent.click(within(card).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(a.save).toHaveBeenCalledWith("products", null, expect.objectContaining({ name: "Cotton towel", price: "250", colours: ["blue"], count: "10" })));
  });
  it("what was not said (no colour) opens the form with what was understood and asks for the rest", async () => {
    section("products");
    fireEvent.click(screen.getByText("Say it"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Tell me what you sell"), { target: { value: "Cotton towel, 250 rupees" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Show what you understood" }));
    expect(await screen.findByText(/I got most of it/)).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Cotton towel");
    expect(screen.getByLabelText("Price in rupees")).toHaveValue("250");
  });
  it("no name in what was said: it says so and keeps the box", async () => {
    section("products");
    fireEvent.click(screen.getByText("Say it"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Tell me what you sell"), { target: { value: ", 250 rupees" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Show what you understood" }));
    expect(await within(dialog).findByText(/I could not find a name in that/)).toBeInTheDocument();
  });
  it("Take photos in test mode lists what it read; Save all saves each one", async () => {
    const a = actions();
    section("courses", { actions: a });
    fireEvent.click(screen.getByText("Take photos"));
    const card = await screen.findByRole("dialog", { name: "I understood" });
    expect(within(card).getByText("NEET crash course")).toBeInTheDocument();
    expect(a.readSheet).toHaveBeenCalledWith("courses", "photos");
    fireEvent.click(within(card).getByRole("button", { name: "Save all" }));
    await waitFor(() => expect(a.save).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
  it("a real shop whose style has no reader yet is told so in one sentence", async () => {
    const a = actions({ readSheet: vi.fn(async () => ({ ok: false as const, kind: "unavailable" as const, error: "This is not ready for your kind of business yet." })) });
    section("services", { actions: a, live: true });
    fireEvent.click(screen.getByText("Import a sheet"));
    expect(await screen.findByText("This is not ready for your kind of business yet.")).toBeInTheDocument();
  });
  it("a new product that has no photo yet offers its photos (the old page), and the row is on the list", async () => {
    const a = actions({ save: vi.fn(async (_s: SellStyle, _i: string | null, form: SellForm[SellStyle]) => {
      const built = buildEntry("products", "5e110009-0000-4000-8000-000000000001", form, null, true);
      if (!built.ok) throw new Error("form");
      return { ok: true as const, data: { entry: built.entry, photosPath: "/catalogue/5e110009-0000-4000-8000-000000000001", note: null } };
    }) });
    section("products", { actions: a, live: true });
    fireEvent.click(screen.getByRole("button", { name: "Add a product" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Red silk" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Red" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save product" }));
    expect(await screen.findByRole("link", { name: "Add photos" })).toHaveAttribute("href", `${BASE}/catalogue/5e110009-0000-4000-8000-000000000001`);
    expect(document.querySelectorAll("[data-entry]")).toHaveLength(5);
  });
});

describe("words", () => {
  const words4 = (lang: "te" | "hi" | "kn") => Object.fromEntries(Object.entries(appDict(lang) as Record<string, string>).filter(([k]) => k.startsWith("jobs.sell.") || k.startsWith("catalogue.colour.")));
  it.each(["te", "hi", "kn"] as const)("%s: every style draws without a raw key, with Indian script", async (lang) => {
    for (const style of SELL_STYLES) {
      section(style, { w: words4(lang) });
      expect(document.body.textContent, `${lang} ${style}`).not.toMatch(/jobs\.sell\./);
      expect(document.body.textContent).toMatch(/[ఀ-౿ऀ-ॿಀ-೿]/);
      fireEvent.click(document.querySelector('[data-action="add"]') as HTMLElement);
      await screen.findByRole("dialog");
      expect(document.body.textContent, `${lang} ${style} sheet`).not.toMatch(/jobs\.sell\./);
      cleanup();
    }
  });
  it("every jobs.sell.* key has all four languages", () => {
    const keys = Object.keys(dict).filter((k) => k.startsWith("jobs.sell."));
    expect(keys.length).toBeGreaterThan(150);
    for (const lang of ["te", "hi", "kn"] as const) {
      const d = appDict(lang) as Record<string, string>;
      for (const k of keys) expect(d[k], `${lang} ${k}`).toBeTruthy();
    }
  });
  it("the sentences keep their {slots} in every language (a sentence with a slot missing would lose a choice)", () => {
    const slots = (s: string) => [...s.matchAll(/\{([a-z0-9]+)\}/g)].map((m) => m[1]).sort();
    for (const k of Object.keys(dict).filter((x) => x.startsWith("jobs.sell."))) for (const lang of ["te", "hi", "kn"] as const) expect(slots((appDict(lang) as Record<string, string>)[k]), `${lang} ${k}`).toEqual(slots(dict[k]));
  });
});

void EMPTY;
