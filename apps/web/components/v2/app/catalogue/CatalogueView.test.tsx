import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import { CatalogueView, type CatalogueViewProps } from "./CatalogueView";
import { BASE, WORDS, rows } from "./catalogue-test-kit";
import { EMPTY_QUERY, parseQuery } from "./catalogue-logic";

afterEach(cleanup);
const show = (over: Partial<CatalogueViewProps> = {}) =>
  render(<CatalogueView base={BASE} words={WORDS} role="owner" query={EMPTY_QUERY} items={rows()} more={null} lead={null} {...over} />);
const card = (name: RegExp) => screen.getByRole("link", { name });

describe("the catalogue grid", () => {
  it("draws a card per saree: the name, the fabric, the price (exact if the owner set one, else the band) and the badges", () => {
    show();
    expect(screen.getByRole("heading", { level: 1, name: "Catalogue" })).toBeInTheDocument();
    expect(screen.getByText("4 sarees")).toBeInTheDocument();
    const kanchi = card(/Maroon Kanchi pattu/);
    expect(kanchi).toHaveAttribute("href", `${BASE}/catalogue/c27a36f2-ef14-5f33-b10f-3e03bade04aa`);
    expect(within(kanchi).getByText("₹38,500.00")).toBeInTheDocument();
    const soft = card(/Soft silk in peacock blue/);
    expect(within(soft).getByText("₹5,000 to ₹10,000")).toBeInTheDocument();
    expect(within(soft).getByText("Few left")).toBeInTheDocument();
    expect(within(card(/Georgette in blush pink/)).getByText("Made to order")).toBeInTheDocument();
    expect(within(kanchi).queryByText("Few left")).toBeNull();
  });

  it("greys the hidden sarees for the owner and admin and says they are hidden; the page was only given the visible ones for anyone else", () => {
    const { rerender } = show({ role: "admin" });
    const hidden = card(/Old Banarasi/);
    expect(hidden).toHaveAttribute("data-hidden", "true");
    expect(within(hidden).getByText("Hidden from customers")).toBeInTheDocument();
    expect(hidden.querySelector(".grayscale")).not.toBeNull();
    expect(card(/Maroon Kanchi pattu/)).not.toHaveAttribute("data-hidden");
    rerender(<CatalogueView base={BASE} words={WORDS} role="sales" query={EMPTY_QUERY} items={rows().filter((r) => r.active)} more={null} lead={null} />);
    expect(screen.queryByText(/Old Banarasi/)).toBeNull();
    expect(screen.queryByText("Hidden from customers")).toBeNull();
  });

  it("loads photos lazily, gives each picture its box before it loads (no layout shift) and draws the first two at once", () => {
    show();
    const imgs = Array.from(document.querySelectorAll("[data-grid=items] img"));
    expect(imgs).toHaveLength(4);
    expect(imgs.map((i) => i.getAttribute("loading"))).toEqual(["eager", "eager", "lazy", "lazy"]);
    for (const img of imgs) {
      expect(img).toHaveAttribute("width");
      expect(img).toHaveAttribute("height");
      expect(img).toHaveAttribute("alt", ""); // the name beside it says what it is
      expect(img.getAttribute("src")).toContain("_t.jpg"); // the thumbnail, not the big photo
      expect(img.parentElement?.className).toContain("aspect-[4/5]");
    }
  });

  it("a card has a tap target of at least 44 px and the grid is two columns on a phone", () => {
    show();
    expect(card(/Maroon Kanchi pattu/).className).toContain("min-h-11");
    expect(document.querySelector("[data-grid=items]")?.className).toContain("grid-cols-2");
  });

  it("a saree without a cover says so in words in the same box", () => {
    const [first, ...rest] = rows();
    show({ items: [{ ...first, cover: null, photo_count: 0 }, ...rest] });
    expect(within(card(/Maroon Kanchi pattu/)).getByText("No photo")).toBeInTheDocument();
  });

  it("offers Add a saree to the owner and admin only", () => {
    const { rerender } = show({ role: "admin" });
    expect(screen.getByRole("link", { name: "Add a saree" })).toHaveAttribute("href", `${BASE}/catalogue/new`);
    for (const role of ["sales", "viewer"] as const) {
      rerender(<CatalogueView base={BASE} words={WORDS} role={role} query={EMPTY_QUERY} items={rows()} more={null} lead={null} />);
      expect(screen.queryByRole("link", { name: "Add a saree" })).toBeNull();
    }
  });

  it("has a link to older sarees when the API has more, keeping the filters", () => {
    show({ query: parseQuery({ fabric: "soft_silk" }), more: "CUR" });
    expect(screen.getByRole("link", { name: "Show more sarees" })).toHaveAttribute("href", `${BASE}/catalogue?fabric=soft_silk&after=CUR`);
    expect(screen.getByText("4 sarees so far")).toBeInTheDocument();
  });
});

describe("search and filter chips", () => {
  it("searches with a plain GET form, keeping the filters and the customer", () => {
    show({ query: parseQuery({ fabric: "soft_silk", colour: "blue", stock: "few_left", q: "peacock" }), lead: { leadId: "L1", label: "Priya S." } });
    const form = screen.getByRole("search");
    expect(form).toHaveAttribute("method", "get");
    expect(form).toHaveAttribute("action", `${BASE}/catalogue`);
    const hidden = Object.fromEntries(Array.from(form.querySelectorAll("input[type=hidden]")).map((i) => [(i as HTMLInputElement).name, (i as HTMLInputElement).value]));
    expect(hidden).toEqual({ fabric: "soft_silk", colour: "blue", stock: "few_left", lead: "L1" });
    expect(within(form).getByLabelText("Search by name")).toHaveValue("peacock");
  });

  it("each chip is a link that turns that choice on or off; the chips that are on are said to be selected", () => {
    show({ query: parseQuery({ fabric: "soft_silk", colour: "blue" }) });
    const on = screen.getByRole("link", { name: /Soft silk.*selected/ });
    expect(on).toHaveAttribute("href", `${BASE}/catalogue?colour=blue`); // pressing it again turns the fabric off
    expect(screen.getByRole("link", { name: "Banarasi" })).toHaveAttribute("href", `${BASE}/catalogue?fabric=banarasi&colour=blue`);
    expect(screen.getByRole("link", { name: "Red" })).toHaveAttribute("href", `${BASE}/catalogue?fabric=soft_silk&colour=blue%2Cred`);
    expect(screen.getByRole("link", { name: "Few left" })).toHaveAttribute("href", `${BASE}/catalogue?fabric=soft_silk&colour=blue&stock=few_left`);
    expect(screen.getByRole("link", { name: "Under ₹5,000" })).toBeInTheDocument();
    expect(on.className).toContain("min-h-11");
  });

  it("opens the filters when one is on, with the number, and offers to clear them", () => {
    const { container, rerender } = show();
    expect(container.querySelector("details")).not.toHaveAttribute("open");
    expect(screen.getByText("Filters")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Clear filters" })).toBeNull();
    rerender(<CatalogueView base={BASE} words={WORDS} role="owner" query={parseQuery({ fabric: "soft_silk", stock: "few_left", q: "x" })} items={rows()} more={null} lead={{ leadId: "L1", label: "Priya S." }} />);
    expect(container.querySelector("details")).toHaveAttribute("open");
    expect(screen.getByText("Filters (2)")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Clear filters" })).toHaveAttribute("href", `${BASE}/catalogue?lead=L1`);
  });

  it("when a customer is being chosen for, says so and carries the customer to the saree's page", () => {
    show({ lead: { leadId: "L1", label: "Priya S." } });
    expect(screen.getByText(/Choose a saree to send to Priya S\./)).toBeInTheDocument();
    expect(card(/Maroon Kanchi pattu/)).toHaveAttribute("href", `${BASE}/catalogue/c27a36f2-ef14-5f33-b10f-3e03bade04aa?lead=L1`);
  });
});

describe("empty, no match, and unreadable", () => {
  it("an empty catalogue shows the owl and 'Add your first saree' (with the button for the owner and admin)", () => {
    show({ items: [] });
    expect(screen.getByRole("heading", { name: "Add your first saree" })).toBeInTheDocument();
    expect(document.querySelector("[data-state=empty] svg[data-owl]")).not.toBeNull();
    expect(screen.getAllByRole("link", { name: "Add a saree" })).toHaveLength(1); // one call to action, not two
  });

  it("an empty catalogue tells everyone else who can add sarees, with no button", () => {
    show({ items: [], role: "sales" });
    expect(screen.getByText(/The owner or an admin can add them/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Add a saree" })).toBeNull();
  });

  it("filters that match nothing say so and do not offer 'add your first saree'", () => {
    show({ items: [], query: parseQuery({ q: "zzz" }) });
    expect(screen.getByText("No saree matches")).toBeInTheDocument();
    expect(screen.queryByText("Add your first saree")).toBeNull();
  });

  it("a catalogue that could not be read says 'Not available yet' in its place, and the rest of the page is still there", () => {
    show({ items: null });
    expect(screen.getByRole("alert")).toHaveTextContent("Not available yet");
    expect(screen.getByRole("search")).toBeInTheDocument();
  });
});
