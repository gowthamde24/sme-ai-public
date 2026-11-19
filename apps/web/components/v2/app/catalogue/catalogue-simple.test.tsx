import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push, refresh: nav.refresh }) }));
// the lazy chunks are drawn at once in a unit test
vi.mock("../jobs/pages/LazyLinkSentence", async () => ({ LinkSentence: (await import("../jobs/pages/LinkSentence")).LinkSentence }));
vi.mock("./LazyItemFieldsSimple", async () => ({ ItemFieldsSimple: (await import("./ItemFieldsSimple")).ItemFieldsSimple }));

import { catalogueWords } from "@/app/app/tenants/[tenantId]/catalogue/catalogue-words";

import { CatalogueView } from "./CatalogueView";
import { ItemEditor } from "./ItemEditor";
import { BASE, fakeEditorActions, item, makeWorld, rows } from "./catalogue-test-kit";
import { EMPTY_QUERY, hrefFor, parseQuery, toggled } from "./catalogue-logic";

const W = catalogueWords("en", true);
const ID = "c27a36f2-ef14-5f33-b10f-3e03bade04aa";
afterEach(cleanup);
beforeEach(() => nav.push.mockReset());

const said = (el: Element | null): string => {
  const clone = el!.cloneNode(true) as HTMLElement;
  const live = Array.from(el!.querySelectorAll("select"));
  clone.querySelectorAll("select").forEach((sel, i) => sel.replaceWith(document.createTextNode(live[i].selectedOptions[0]?.textContent ?? "")));
  clone.querySelectorAll("svg").forEach((n) => n.remove());
  return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
};
const line = (name: string) => document.querySelector(`[data-setting-line="${name}"]`);
const pick = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("Catalogue filters as a sentence (JOBS)", () => {
  const show = (query = EMPTY_QUERY, simple = true) => render(<CatalogueView base={BASE} words={W} role="owner" query={query} items={rows()} more={null} lead={null} simple={simple} />);

  it("says 'Show all sarees made of any fabric.' with the search and one live line; colour, occasion and price are under More choices", () => {
    show();
    expect(said(line("catalogue"))).toBe("Show all sarees made of any fabric.");
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Showing 4 sarees.");
    const more = document.querySelector('[data-part="more-choices"]') as HTMLDetailsElement;
    expect(more.open).toBe(false);
    expect(within(more).getAllByRole("group").map((g) => g.querySelector("legend")?.textContent)).toEqual(["Colour", "Occasion", "Price"]);
    // the old collapsed "Filters" box is gone
    expect(screen.queryByText("Filters")).toBeNull();
  });

  it("a stock or fabric choice goes to the address of the old chip (the customer being chosen for is kept)", () => {
    const q = parseQuery({ colour: "blue" });
    render(<CatalogueView base={BASE} words={W} role="owner" query={q} items={rows()} more={null} lead={{ leadId: "L1", label: "Ravi" }} simple />);
    pick("Stock", "few_left");
    expect(nav.push).toHaveBeenLastCalledWith(hrefFor(BASE, toggled(q, "stock", "few_left"), { lead: "L1" }));
    pick("Fabric", "soft_silk");
    expect(nav.push).toHaveBeenLastCalledWith(hrefFor(BASE, toggled(q, "fabric", "soft_silk"), { lead: "L1" }));
    pick("Fabric", "any");
    expect(nav.push).toHaveBeenLastCalledWith(hrefFor(BASE, { ...q, fabric: null }, { lead: "L1" }));
    // the old chip led to the same place
    cleanup();
    render(<CatalogueView base={BASE} words={W} role="owner" query={q} items={rows()} more={null} lead={{ leadId: "L1", label: "Ravi" }} />);
    expect(screen.getByRole("link", { name: "Soft silk" })).toHaveAttribute("href", hrefFor(BASE, toggled(q, "fabric", "soft_silk"), { lead: "L1" }));
  });

  it("a colour chip under More choices is the old link; More choices is open while one is on; the search keeps the filters", () => {
    const q = parseQuery({ colour: "blue", fabric: "soft_silk", stock: "few_left", q: "blue" });
    show(q);
    expect((document.querySelector('[data-part="more-choices"]') as HTMLDetailsElement).open).toBe(true);
    expect(screen.getByRole("link", { name: /Red/ })).toHaveAttribute("href", hrefFor(BASE, toggled(q, "colour", "red"), { lead: null }));
    const form = screen.getByRole("search");
    expect(Array.from(form.querySelectorAll("input[type=hidden]")).map((i) => (i as HTMLInputElement).name)).toEqual(["fabric", "colour", "stock"]);
    expect(said(line("catalogue"))).toBe("Show sarees with few left made of Soft silk.");
  });

  it("JOBS off: the search box, the Filters box and the results line are drawn as before", () => {
    show(EMPTY_QUERY, false);
    expect(screen.getByText("Filters")).toBeInTheDocument();
    expect(screen.getByText("4 sarees")).toBeInTheDocument();
    expect(document.querySelector("[data-simple]")).toBeNull();
  });
});

describe("Add or change a saree as sentences (JOBS)", () => {
  const draw = (over: { item?: ReturnType<typeof item> | null; role?: "owner" | "admin" } = {}) => {
    const world = makeWorld(over.item ?? null);
    const go = vi.fn();
    render(<ItemEditor simple base={BASE} itemId={ID} item={over.item ?? null} role={over.role ?? "owner"} words={W} uploadUrl={`${BASE}/catalogue/${ID}/photos`} actions={world.actions} uploader={world.uploader} prepare={async (f) => ({ ok: true as const, blob: f as Blob })} go={go} />);
    return { ...world, go };
  };
  const save = () => act(async () => void fireEvent.click(screen.getByRole("button", { name: "Save" })));

  it("the name, ONE sentence with the choices inside, the colours and one live line; the rare things are under More choices", () => {
    draw();
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(said(line("item"))).toBe("A Kanchi pattu saree, about ₹10,000 to ₹25,000.");
    expect(screen.getByText("Choose colours")).toBeInTheDocument();
    expect(document.querySelector('[data-part="item-effect"]')).toHaveTextContent("What customers see: nothing yet. Tick “Show this saree to customers” when “this saree” is ready.");
    const more = document.querySelector('[data-part="more-choices"]') as HTMLDetailsElement;
    expect(more.open).toBe(false);
    for (const inside of ["Zari", "Stock", "Border", "Occasions", "Exact price"]) expect(more).toHaveTextContent(inside);
  });

  it("every choice is kept in the same save as before (same fields, same values)", async () => {
    const w = draw();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Blue soft silk" } });
    pick("Fabric", "soft_silk");
    pick("Price range", "25k_50k");
    fireEvent.click(screen.getByLabelText("Blue"));
    pick("Zari", "light");
    pick("Stock", "few_left");
    fireEvent.change(screen.getByLabelText("Border"), { target: { value: "Plain" } });
    fireEvent.click(screen.getByLabelText("Wedding"));
    expect(document.querySelector('[data-part="item-effect"]')).toHaveTextContent("What customers see: nothing yet.");
    await save();
    expect(w.actions.save).toHaveBeenCalledWith(ID, expect.objectContaining({ name: "Blue soft silk", fabric: "soft_silk", colours: ["blue"], zari: "light", border: "Plain", occasions: ["wedding"], priceBand: "25k_50k", stockStatus: "few_left", active: false }));
    expect(w.go).toHaveBeenCalledWith(`${BASE}/catalogue/${ID}?saved=1`);
  });

  it("keeps the limits and the refusals: a name and a colour are needed; at most four colours", async () => {
    draw();
    await save();
    expect(screen.getByRole("alert")).toHaveTextContent("Write a name for the saree.");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "X" } });
    await save();
    expect(screen.getByRole("alert")).toHaveTextContent("Pick one to four colours.");
    for (const c of ["Red", "Maroon", "Pink", "Orange"]) fireEvent.click(screen.getByLabelText(c));
    expect(screen.getByLabelText("Yellow")).toBeDisabled();
  });

  it("the exact price stays the owner's: an admin sees it read-only and no field", () => {
    draw({ item: item(), role: "admin" });
    expect(screen.queryByLabelText(/Exact price/)).toBeNull();
    expect(document.querySelector('[data-part="exact-price"]')).toHaveTextContent("Only the owner can set");
  });

  it("show to customers is a round tick; ticking it changes the live line", () => {
    draw({ item: item() });
    expect(document.querySelector('[data-part="item-effect"]')).toHaveTextContent(/“DEMO Maroon Kanchi pattu”, Kanchi pattu, about/);
    const tick = screen.getByLabelText(/Show this saree to customers/);
    expect(tick).toBeChecked();
    fireEvent.click(tick);
    expect(document.querySelector('[data-part="item-effect"]')).toHaveTextContent(/nothing yet/);
  });

  it("JOBS off: the form is drawn as before", () => {
    const world = makeWorld(null);
    render(<ItemEditor base={BASE} itemId={ID} item={null} role="owner" words={W} uploadUrl="x" actions={fakeEditorActions()} uploader={world.uploader} />);
    expect(screen.getByLabelText("Fabric")).toHaveProperty("id", "cat-fabric");
    expect(document.querySelector("[data-simple]")).toBeNull();
  });
});
