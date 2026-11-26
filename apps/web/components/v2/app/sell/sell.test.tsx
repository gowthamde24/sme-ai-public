import { readFileSync } from "node:fs";
import path from "node:path";
import { expectNoSentenceForm } from "@/test/helpers/no-sentence-form";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appDict } from "@/i18n/app";
import { parseSellList, parseSellReading } from "@/lib/api/what-you-sell";
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
const wordsOf = (d: Record<string, string>) => Object.fromEntries(Object.entries(d).filter(([k]) => k.startsWith("jobs.sell.") || k.startsWith("catalogue.colour.") || k === "jobs.tb.s5.security"));
const words = wordsOf(dict);
const BASE = "/app/tenants/t";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const entriesOf = (s: SellStyle) => parseSellList(wireSell(s), s);

function actions(over: Partial<SellActions> = {}): SellActions {
  return {
    // the mock's save: what the page's action does in test mode (checks the form, answers the entry)
    save: vi.fn(async (style: SellStyle, id: string | null, form: SellForm[SellStyle]) => {
      const built = buildEntry(style, id ?? "5e110009-0000-4000-8000-000000000001", form, null, true);
      return built.ok ? { ok: true as const, data: { entry: built.entry, photosPath: null, note: null } } : { ok: false as const, kind: "invalid" as const, error: `refused: ${built.code}` };
    }),
    remove: vi.fn(async (_style: SellStyle, id: string) => ({ ok: true as const, data: { id } })),
    understand: vi.fn(async (style: SellStyle, text: string) => ({ ok: true as const, data: { form: understand(style, text) } })),
    read: vi.fn(async () => ({ ok: true as const, data: { entries: [], unclear: true, notes: [] } })),
    readProducts: vi.fn(async () => ({ ok: true as const, data: { drafts: [], unclear: true, notes: [], readBy: null, pages: 0 } })),
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
    expect(document.querySelector('[data-part="what-you-sell"]')).toHaveAttribute("data-sell-kind", style);
  });
  it("an empty list says what to do, in one sentence", () => {
    section("services", { entries: [] });
    expect(screen.getByText(/Nothing here yet\. Say it, take a photo or import a sheet/)).toBeInTheDocument();
  });
  it("a long list (8 or more) has a search box by name; a short one does not; nothing found says so (26 Nov 2026: a saree shop's 40 products had none)", () => {
    const base = entriesOf("products");
    const many = Array.from({ length: 9 }, (_, i) => ({ ...base[i % base.length], id: `5e110009-0000-4000-8000-0000000000${String(10 + i)}`, name: i === 4 ? "Kanchi pattu bridal" : `Saree ${i}` }) as SellEntry);
    section("products", { entries: many.slice(0, 3) });
    expect(document.querySelector('[data-part="find"]')).toBeNull();
    cleanup();
    section("products", { entries: many });
    const find = document.querySelector('[data-part="find"]') as HTMLInputElement;
    expect(find).toHaveAttribute("aria-label", "Search by name");
    fireEvent.change(find, { target: { value: "kanchi" } });
    expect(document.querySelectorAll("[data-entry]")).toHaveLength(1);
    fireEvent.change(find, { target: { value: "zzz" } });
    expect(screen.getByText("Nothing matches that. Try fewer letters.")).toBeInTheDocument();
    expect(document.querySelectorAll("[data-entry]")).toHaveLength(0);
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
    expect(a.save).toHaveBeenCalledWith("products", null, { name: "Red Kanchi silk", price: "9,000", colours: ["red", "gold"], stock: "few_left", count: "2" }, { freshId: expect.stringMatching(UUID) });
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
  it("the Add an item drawer is plain labelled fields: Name, Smallest order and Counted in, a table of rates with two column headings, Rates valid until with its hint; no sentence with a blank (owner, 29 Nov)", async () => {
    section("pricelist");
    fireEvent.click(screen.getByRole("button", { name: "Add an item" }));
    const dialog = await screen.findByRole("dialog");
    for (const label of ["Name", "Smallest order", "Counted in", "Rates valid until"]) expect(within(dialog).getByLabelText(label)).toBeInTheDocument();
    expect(within(dialog).getByText("Rates for bigger orders")).toBeInTheDocument();
    expect(within(dialog).getByText(/^From \(/)).toBeInTheDocument();
    expect(within(dialog).getByText(/^Price per .* \(₹\)$/)).toBeInTheDocument();
    expect(within(dialog).getByText("Optional. Leave empty if the rates have no end date.")).toBeInTheDocument();
    expect(dialog.textContent).not.toMatch(/The smallest order is|These rates are good until|₹ .* a /);
    expectNoSentenceForm(dialog);
  });
  it("every style's drawer is free of sentence forms", async () => {
    for (const [style, button] of [["products", "Add a product"], ["services", "Add a service"], ["courses", "Add a course"], ["properties", "Add a property"]] as const) {
      section(style);
      const open = screen.queryByRole("button", { name: button });
      if (!open) { cleanup(); continue; }
      fireEvent.click(open);
      expectNoSentenceForm(await screen.findByRole("dialog"));
      cleanup();
    }
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
    await waitFor(() => expect(a.save).toHaveBeenCalledWith("products", null, expect.objectContaining({ name: "Cotton towel", price: "250", colours: ["blue"], count: "10" }), { freshId: expect.stringMatching(UUID) }));
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
  it("a real shop whose reading call is not there yet (404) is told so in one sentence, after the file went up", async () => {
    const a = actions({ read: vi.fn(async () => ({ ok: false as const, kind: "unavailable" as const, error: "This is not ready for your kind of business yet." })) });
    vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => ({ ok: true, file_id: "5e110009-0000-4000-8000-0000000000aa" }) })));
    section("services", { actions: a, live: true });
    fireEvent.click(screen.getByText("Import a sheet"));
    const input = (await screen.findByRole("dialog")).querySelector('[data-part="pick-file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["a,b"], "prices.csv", { type: "text/csv" })] } });
    expect(await screen.findByText("This is not ready for your kind of business yet.")).toBeInTheDocument();
    expect(a.read).toHaveBeenCalledWith("services", { kind: "sheet", fileId: "5e110009-0000-4000-8000-0000000000aa" });
    expect(a.readSheet).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
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

describe("a real workspace: the reading call, the writes with a client-side id, the Security link", () => {
  const svc = (over: Record<string, unknown> = {}) => ({ name: "Haircut", minutes: 30, price_paise: 20_000, price_from: false, booking: "any_day", place: null, ...over });
  const reading = (rows: Record<string, unknown>[], notes: { code: string; row?: number }[] = [], unclear = false) => ({ ok: true as const, data: parseSellReading({ style: "services", drafts: rows, unclear, notes }, "services") });
  const say = async (text: string) => {
    fireEvent.click(screen.getByText("Say it"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Tell me what you sell"), { target: { value: text } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Show what you understood" }));
    return dialog;
  };
  it("Say it asks the reading call with the words as they are (not the closed-word parser) and draws the drafts and the notes in plain words", async () => {
    const a = actions({ read: vi.fn(async () => reading([svc(), svc({ name: "Facial", price_paise: null })], [{ code: "price_missing", row: 2 }])) });
    section("services", { actions: a, live: true });
    const dialog = await say("haircut 200, facial");
    expect(await within(dialog).findByText("Haircut")).toBeInTheDocument();
    expect(a.read).toHaveBeenCalledWith("services", { kind: "talk", text: "haircut 200, facial" });
    expect(a.understand).not.toHaveBeenCalled();
    expect(within(dialog).getByText(/Row 2: No price was said/)).toBeInTheDocument();
    expect(document.querySelectorAll('[data-part="understood"] li')).toHaveLength(2 + 1);
  });
  it("Save all sends each complete draft with its own id; a draft with no price stays on the card (a price is never guessed)", async () => {
    const out = reading([svc(), svc({ name: "Facial", price_paise: null })], [{ code: "price_missing", row: 2 }]);
    const a = actions({ read: vi.fn(async () => out) });
    section("services", { actions: a, live: true });
    const dialog = await say("haircut 200, facial");
    fireEvent.click(await within(dialog).findByRole("button", { name: "Save all" }));
    await waitFor(() => expect(a.save).toHaveBeenCalledTimes(1));
    expect(a.save).toHaveBeenCalledWith("services", null, expect.objectContaining({ name: "Haircut", price: "200" }), { freshId: out.data.entries[0].id });
    expect(await within(dialog).findByText(/Some are not complete yet/)).toBeInTheDocument();
    expect(within(dialog).getByText("Facial")).toBeInTheDocument();
    expect(within(dialog).queryByText("Haircut")).toBeNull();
  });
  it("words it could not understand: the sentence says so and keeps the box", async () => {
    const a = actions({ read: vi.fn(async () => reading([], [], true)) });
    section("services", { actions: a, live: true });
    const dialog = await say("blah blah");
    expect(await within(dialog).findByText(/I could not understand that/)).toBeInTheDocument();
  });
  it("products keep the closed-word Say it (the reading call is for the other four styles)", async () => {
    const a = actions();
    section("products", { actions: a, live: true });
    await say("Cotton towel, 250 rupees, blue, 10 in stock");
    await waitFor(() => expect(a.understand).toHaveBeenCalled());
    expect(a.read).not.toHaveBeenCalled();
  });
  it("a file that is too big or of a wrong kind is refused in plain words before anything goes up", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const a = actions();
    section("services", { actions: a, live: true });
    fireEvent.click(screen.getByText("Take photos"));
    const dialog = await screen.findByRole("dialog");
    const input = dialog.querySelector('[data-part="pick-file"]') as HTMLInputElement;
    const big = new File(["x"], "shelf.jpg", { type: "image/jpeg" });
    Object.defineProperty(big, "size", { value: 16 * 1024 * 1024 });
    fireEvent.change(input, { target: { files: [big] } });
    expect(await within(dialog).findByText(/too big/)).toBeInTheDocument();
    fireEvent.change(input, { target: { files: [new File(["x"], "notes.docx")] } });
    expect(await within(dialog).findByText(/photos, PDFs and sheets/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(a.read).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
  it("a photo goes up through the sheet's own route, then the reading call asks for kind photo with the file id", async () => {
    const fetchMock = vi.fn((...args: unknown[]) => Promise.resolve({ args, json: async () => ({ ok: true, file_id: "5e110009-0000-4000-8000-0000000000bb" }) }));
    vi.stubGlobal("fetch", fetchMock);
    const a = actions({ read: vi.fn(async () => reading([svc()])) });
    section("services", { actions: a, live: true });
    fireEvent.click(screen.getByText("Take photos"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(dialog.querySelector('[data-part="pick-file"]') as HTMLInputElement, { target: { files: [new File(["x"], "shelf.jpg", { type: "image/jpeg" })] } });
    expect(await within(dialog).findByText("Haircut")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/what-you-sell/upload?name=shelf.jpg`);
    expect(a.read).toHaveBeenCalledWith("services", { kind: "photo", fileId: "5e110009-0000-4000-8000-0000000000bb" });
    vi.unstubAllGlobals();
  });
  it("the same new entry sent again after a failure carries the SAME id (a retry, never a second row)", async () => {
    const save = vi.fn()
      .mockResolvedValueOnce({ ok: false as const, kind: "unavailable" as const, error: "Busy." })
      .mockImplementation(async (style: SellStyle, id: string | null, form: SellForm[SellStyle], extra?: { freshId?: string }) => {
        const built = buildEntry(style, id ?? extra?.freshId ?? "x", form, null, true);
        if (!built.ok) throw new Error("form");
        return { ok: true as const, data: { entry: built.entry, photosPath: null, note: null } };
      });
    section("services", { actions: actions({ save }), live: true });
    fireEvent.click(screen.getByRole("button", { name: "Add a service" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Facial" } });
    fireEvent.change(within(dialog).getByLabelText("Price in rupees"), { target: { value: "700" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save service" }));
    expect(await within(dialog).findByText("Busy.")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Save service" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[0][3]).toEqual(save.mock.calls[1][3]);
    expect(save.mock.calls[0][3].freshId).toMatch(UUID);
  });
  it("a price change that needs the second step shows the way to Security", async () => {
    const save = vi.fn(async () => ({ ok: false as const, kind: "mfa" as const, mfa: true, error: "Saving needs your two-step code first." }));
    section("services", { actions: actions({ save }), live: true });
    fireEvent.click(screen.getByRole("button", { name: "Add a service" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Facial" } });
    fireEvent.change(within(dialog).getByLabelText("Price in rupees"), { target: { value: "700" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save service" }));
    expect(await within(dialog).findByText("Saving needs your two-step code first.")).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "Open Security" })).toHaveAttribute("href", "/app/security");
  });
  it("changing a course carries its seats as they are (the owner's own count), so a rename does not reset them", async () => {
    const a = actions();
    section("courses", { actions: a, live: true });
    fireEvent.click(document.querySelector('[data-entry] button') as HTMLElement);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "NEET crash batch" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Save/ }));
    await waitFor(() => expect(a.save).toHaveBeenCalled());
    expect((a.save as ReturnType<typeof vi.fn>).mock.calls[0][3]).toEqual({ course: { seats: { state: "left", count: 6 }, total: 30 } });
  });
  it("Remove asks twice (a tap, then a tap again), calls remove, and the row goes", async () => {
    const a = actions();
    section("services", { actions: a, live: true });
    fireEvent.click(document.querySelector('[data-entry] button') as HTMLElement);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove this" }));
    expect(a.remove).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Tap again to remove it" }));
    await waitFor(() => expect(a.remove).toHaveBeenCalledWith("services", expect.stringMatching(/^5e11000/)));
    await waitFor(() => expect(document.querySelectorAll("[data-entry]")).toHaveLength(3));
  });
  it("products have no Remove (the old catalogue page keeps that)", async () => {
    section("products", { actions: actions(), live: true });
    fireEvent.click(document.querySelector('[data-entry] button') as HTMLElement);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("button", { name: "Remove this" })).toBeNull();
  });
  it("a service with no fixed time (a gym membership) is drawn with no minutes and saved with minutes empty", () => {
    const entries = parseSellList({ style: "services", items: [{ id: "5e110002-0000-4000-8000-000000000077", name: "Monthly membership", minutes: null, price_paise: 150_000, price_from: false, booking: "any_day", place: null }] }, "services");
    section("services", { entries });
    expect(document.querySelector("[data-entry]")?.textContent).toContain("Monthly membership");
    expect(document.querySelector("[data-entry]")?.textContent).not.toMatch(/minutes|hour/);
    const built = buildEntry("services", "5e110002-0000-4000-8000-000000000077", { ...EMPTY.services, name: "Monthly membership", minutes: "", price: "1500" }, null, true);
    expect(built).toMatchObject({ ok: true, entry: { minutes: null, pricePaise: 150_000 } });
  });
});

describe("a saree shop's price list: Import a sheet reads it, shows a table to check, and adds only what is ready (26 Nov 2026)", () => {
  const CSV_TEXT = readFileSync(path.resolve(__dirname, "../../../../lib/sell/__fixtures__/sarees.csv"), "utf8");
  const fileOf = (name: string, text: string, type = "text/csv") => {
    const f = new File([text], name, { type });
    if (typeof f.text !== "function") Object.defineProperty(f, "text", { value: async () => text });
    return f;
  };
  const open = async (a: SellActions) => {
    section("products", { actions: a, live: true });
    fireEvent.click(screen.getByText("Import a sheet"));
    return (await screen.findByRole("dialog")) as HTMLElement;
  };
  const pickFile = (dialog: HTMLElement, file: File) => fireEvent.change(dialog.querySelector('[data-part="pick-file"]') as HTMLInputElement, { target: { files: [file] } });

  it("a CSV: a table of every row with one plain status each, the counts, and nothing saved yet", async () => {
    const a = actions();
    const dialog = await open(a);
    expect(within(dialog).getByText(/an Excel or CSV file, a PDF, or a photo of the list/)).toBeInTheDocument();
    pickFile(dialog, fileOf("sarees.csv", CSV_TEXT));
    expect(await within(dialog).findByText("We read 10 rows from sarees.csv. Fix what is marked, then add them.")).toBeInTheDocument();
    const counts = dialog.querySelector('[data-part="import-counts"]') as HTMLElement;
    expect(counts).toHaveTextContent("7 ready");
    expect(counts).toHaveTextContent("2 need a look");
    expect(counts).toHaveTextContent("1 left out (same name twice)");
    expect(dialog.querySelectorAll("[data-row]")).toHaveLength(10);
    expect(within(dialog).getByText("Add a price")).toBeInTheDocument();
    expect(within(dialog).getByText("Write the price as a number, like 24,500")).toBeInTheDocument();
    expect(within(dialog).getByText("Same name twice: left out")).toBeInTheDocument();
    expect(within(dialog).getByText("Nothing is added until you press the button.")).toBeInTheDocument();
    expect(a.save).not.toHaveBeenCalled();
    expect(a.read).not.toHaveBeenCalled(); // an Excel or CSV file is read in the browser, never sent
  });
  it("fixing a price or removing a row changes the counts at once; the button says how many it adds, and adds them one by one", async () => {
    const a = actions();
    const dialog = await open(a);
    pickFile(dialog, fileOf("sarees.csv", CSV_TEXT));
    await within(dialog).findByText(/We read 10 rows/);
    const rows = [...dialog.querySelectorAll("[data-row]")];
    const chanderi = rows.find((r) => (r.querySelector("input") as HTMLInputElement).value === "Chanderi plain") as HTMLElement;
    fireEvent.change(chanderi.querySelectorAll("input")[1], { target: { value: "2,500" } });
    const noPrice = rows.find((r) => (r.querySelector("input") as HTMLInputElement).value === "Cotton saree daily wear") as HTMLElement;
    fireEvent.click(within(noPrice).getByRole("button", { name: /Remove row/ }));
    expect(dialog.querySelector('[data-part="import-counts"]')).toHaveTextContent("8 ready");
    const add = within(dialog).getByRole("button", { name: "Add 8 sarees" });
    fireEvent.click(add);
    await waitFor(() => expect(a.save).toHaveBeenCalledTimes(8));
    const first = (a.save as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(first[0]).toBe("products");
    expect(first[2]).toMatchObject({ name: "Kanchi pattu bridal red", price: "24500", colours: ["red"], stock: "in_stock", count: "5" });
    expect(first[3]).toMatchObject({ fabric: "kanchi_pattu" });
    expect(await within(dialog).findByText("8 sarees added.")).toBeInTheDocument();
    expect(within(dialog).getByText("A saree shows to customers once it has a photo. Add the photos next.")).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "Add photos" })).toHaveAttribute("href", `${BASE}/catalogue`);
  });
  it("a refusal stops the run, says why, and keeps the rows that were not added", async () => {
    const save = vi.fn().mockResolvedValueOnce({ ok: true as const, data: { entry: entriesOf("products")[0], photosPath: null, note: null } }).mockResolvedValue({ ok: false as const, kind: "invalid" as const, error: "Busy. Try again in a minute." });
    const dialog = await open(actions({ save }));
    pickFile(dialog, fileOf("sarees.csv", CSV_TEXT));
    await within(dialog).findByText(/We read 10 rows/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Add 7 sarees" }));
    expect(await within(dialog).findByText("Busy. Try again in a minute.")).toBeInTheDocument();
    expect(save).toHaveBeenCalledTimes(2);
    expect(dialog.querySelectorAll('[data-row="ok"]')).toHaveLength(6); // one was added; six wait (the second "Kanchi pattu bridal red" stays left out: that saree was added)
  });
  it("an Excel file (.xlsx) is read in the browser and gives the same rows as the CSV", async () => {
    const xlsx = readFileSync(path.resolve(__dirname, "../../../../lib/sell/__fixtures__/sarees.xlsx"));
    const f = new File([xlsx], "sarees.xlsx");
    Object.defineProperty(f, "arrayBuffer", { value: async () => xlsx.buffer.slice(xlsx.byteOffset, xlsx.byteOffset + xlsx.byteLength) });
    const dialog = await open(actions());
    pickFile(dialog, f);
    expect(await within(dialog).findByText(/We read 10 rows from sarees.xlsx/)).toBeInTheDocument();
    expect(dialog.querySelector('[data-part="import-counts"]')).toHaveTextContent("7 ready");
  });
  it("an old .xls, an empty file, a header with no rows and a file that is not a list each say what to do, in plain words", async () => {
    const dialog = await open(actions());
    pickFile(dialog, fileOf("old.xls", "x", "application/vnd.ms-excel"));
    expect(await within(dialog).findByText(/Old Excel files \(\.xls\) cannot be read/)).toBeInTheDocument();
    pickFile(dialog, fileOf("empty.csv", " \n"));
    expect(await within(dialog).findByText("That file has nothing in it.")).toBeInTheDocument();
    pickFile(dialog, fileOf("head.csv", "Name,Price\n"));
    expect(await within(dialog).findByText(/We could not find any sarees in that/)).toBeInTheDocument();
  });
  it("a PDF or a photo goes up and the products reading turns it into the same table, the unsure rows marked; every refusal is one plain sentence", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ json: async () => ({ ok: true, file_id: "5e110009-0000-4000-8000-0000000000bb" }) })));
    const readProducts = vi.fn(async () => ({
      ok: true as const,
      data: { drafts: [{ name: "Banarasi georgette", pricePaise: 980_000, unit: null, notes: null, confidence: "high" as const }, { name: "Soft silk blue", pricePaise: 620_000, unit: null, notes: "smudged", confidence: "low" as const }, { name: "Cotton daily", pricePaise: null, unit: null, notes: null, confidence: "medium" as const }], unclear: false, notes: [{ code: "price_missing" as const, row: 3 }], readBy: "ai_vision" as const, pages: 1 },
    }));
    const a = actions({ readProducts });
    const dialog = await open(a);
    pickFile(dialog, new File(["%PDF"], "list.pdf", { type: "application/pdf" }));
    expect(await within(dialog).findByText(/We read 3 rows from list.pdf/)).toBeInTheDocument();
    expect(readProducts).toHaveBeenCalledWith("5e110009-0000-4000-8000-0000000000bb");
    expect(a.read).not.toHaveBeenCalled();
    expect(within(dialog).getByText(/Read from the picture by the assistant. It can misread/)).toBeInTheDocument();
    const rows = [...dialog.querySelectorAll("[data-row]")] as HTMLElement[];
    expect(rows[0]).not.toHaveAttribute("data-unsure"); // a sure row is not marked
    expect(rows[1]).toHaveAttribute("data-unsure", "true");
    expect(within(rows[1]).getByText(/Please check this one/)).toBeInTheDocument();
    expect(within(rows[2]).getByText("Add a price")).toBeInTheDocument(); // a draft with no price needs one
    expect(dialog.querySelector('[data-part="import-counts"]')).toHaveTextContent("1 to check");
    fireEvent.change(rows[1].querySelectorAll("input")[1], { target: { value: "6,300" } }); // looking at it and changing it clears the mark
    expect(dialog.querySelector('[data-part="import-counts"]')).not.toHaveTextContent("to check");
    expect(dialog.querySelectorAll("[data-unsure]")).toHaveLength(0);
    cleanup();
    for (const [kind, error] of [["unavailable", "Reading a PDF or a photo of a list is not switched on for your shop yet. Save the list as an Excel or CSV file, or add sarees one by one."], ["invalid", "We cannot read HEIC photos. Share the photo as a JPG and try again."], ["unavailable", "Today's reading limit is used. Try again tomorrow, or use an Excel or CSV file."]] as const) {
      const off = actions({ readProducts: vi.fn(async () => ({ ok: false as const, kind, error })) as never });
      const d2 = await open(off);
      pickFile(d2, new File(["x"], "list.jpg", { type: "image/jpeg" }));
      expect(await within(d2).findByText(error)).toBeInTheDocument();
      cleanup();
    }
    vi.unstubAllGlobals();
  });
});

describe("importing into the list the owner chooses (26 Nov 2026)", () => {
  const CSV_TEXT = "Name,Price\nCotton blue,1450\nGeorgette maroon,\n";
  const TARGETS = [
    { id: "11111111-1111-4111-8111-111111111111", name: "Dress materials", priceKey: "retail", categoryKey: "category", categoryChoices: ["Silk", "Cotton"] },
    { id: "22222222-2222-4222-8222-222222222222", name: "Blouses", priceKey: "price", categoryKey: null, categoryChoices: [] },
  ];
  const open = async (a: SellActions) => {
    render(<SellSection style="products" entries={entriesOf("products")} words={words} base={BASE} actions={a} live ownerPrice paths={{ photos: null, sheet: null }} oldLinks={[]} targets={TARGETS} />);
    fireEvent.click(screen.getByText("Import a sheet"));
    return (await screen.findByRole("dialog")) as HTMLElement;
  };
  it("asks where first (the catalogue's Sarees or one of his lists): no file can be chosen until he has", async () => {
    const dialog = await open(actions());
    const group = within(dialog).getByRole("radiogroup", { name: "Add them to which list?" });
    expect([...group.querySelectorAll('[role="radio"]')].map((r) => r.textContent)).toEqual(["Sarees (the catalogue)", "Dress materials", "Blouses"]);
    expect(within(dialog).getByText("Choose a list first.")).toBeInTheDocument();
    expect(dialog.querySelector('[data-part="pick-file"]')).toBeDisabled();
    fireEvent.click(within(group).getByRole("radio", { name: "Dress materials" }));
    expect(dialog.querySelector('[data-part="pick-file"]')).not.toBeDisabled();
  });
  it("a file for a list goes up, is read by the list's reading, shows the check table, and the checked rows are saved into THAT list with the Category given to rows with none", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ json: async () => ({ ok: true, file_id: "5e110009-0000-4000-8000-0000000000bb" }) })));
    const previewList = vi.fn(async () => ({ ok: true as const, data: { unclear: false, rows: [{ name: "Cotton blue", cells: { retail: 145000, category: "Cotton", lining: "Satin" } }, { name: "Georgette maroon", cells: { retail: null } }] } }));
    const commitList = vi.fn(async () => ({ ok: true as const, data: { created: 2, updated: 0 } }));
    const a = actions({ previewList, commitList });
    const dialog = await open(a);
    fireEvent.click(within(dialog).getByRole("radio", { name: "Dress materials" }));
    const f = new File([CSV_TEXT], "dress.csv", { type: "text/csv" });
    fireEvent.change(dialog.querySelector('[data-part="pick-file"]') as HTMLInputElement, { target: { files: [f] } });
    expect(await within(dialog).findByText("Adding to Dress materials")).toBeInTheDocument();
    expect(previewList).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111", "5e110009-0000-4000-8000-0000000000bb");
    expect(a.readProducts).not.toHaveBeenCalled();
    expect(a.save).not.toHaveBeenCalled(); // nothing goes to the saree catalogue
    const rows = [...dialog.querySelectorAll("[data-row]")] as HTMLElement[];
    expect(rows).toHaveLength(2);
    expect(rows[1]).toHaveAttribute("data-row", "ok"); // a price is optional in a list
    expect((rows[0].querySelectorAll("input")[1] as HTMLInputElement).value).toBe("1450");
    fireEvent.change(within(dialog).getByLabelText("Category for rows that have none"), { target: { value: "Silk" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add 2 sarees" }));
    await waitFor(() => expect(commitList).toHaveBeenCalledTimes(1));
    expect(commitList).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111", [
      { name: "Cotton blue", cells: { lining: "Satin", category: "Cotton", retail: 145000 } },
      { name: "Georgette maroon", cells: { category: "Silk" } },
    ]);
    expect(await within(dialog).findByText("2 items added to Dress materials.")).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "Open Dress materials" })).toHaveAttribute("href", `${BASE}/what-you-sell/lists/11111111-1111-4111-8111-111111111111`);
    vi.unstubAllGlobals();
  });
  it("with no list of his own there is nothing to choose: the catalogue as before", async () => {
    render(<SellSection style="products" entries={entriesOf("products")} words={words} base={BASE} actions={actions()} live ownerPrice paths={{ photos: null, sheet: null }} oldLinks={[]} />);
    fireEvent.click(screen.getByText("Import a sheet"));
    const dialog = (await screen.findByRole("dialog")) as HTMLElement;
    expect(within(dialog).queryByRole("radiogroup")).toBeNull();
    expect(dialog.querySelector('[data-part="pick-file"]')).not.toBeDisabled();
  });
});

