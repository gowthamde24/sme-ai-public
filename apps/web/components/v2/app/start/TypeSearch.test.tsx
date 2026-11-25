import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appDict } from "@/i18n/app";
import type { TypeRow } from "@/lib/packs/type-search";

import { TypeSearch } from "./TypeSearch";

afterEach(cleanup);
const WORDS = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("start.type.")));
const base: TypeRow[] = [
  { id: "textiles", name: "Textiles", line: "Sarees and fabric", keywords: "saree silk fabric" },
  { id: "kirana", name: "Kirana", line: "Grocery", keywords: "grocery provision" },
  { id: "clinic", name: "Clinic", line: "Doctors", keywords: "dental hospital" },
  { id: "other", name: "Other", line: "Something else", keywords: "" },
];
const many: TypeRow[] = [...base, ...Array.from({ length: 12 }, (_, i) => ({ id: `t${i}`, name: `Type ${i}`, line: "x", keywords: "" }))];
const box = () => screen.getByRole("searchbox", { name: "Search your business" });
const tiles = () => [...document.querySelectorAll("[data-type]")].map((e) => e.getAttribute("data-type"));

describe("the business-type tiles with a search box", () => {
  it("a search field above the tiles with the example words; no search shows every tile", () => {
    render(<TypeSearch choices={base} words={WORDS} />);
    expect(box()).toHaveAttribute("placeholder", "For example saree, bakery, clinic");
    expect(tiles()).toEqual(["textiles", "kirana", "clinic", "other"]);
  });
  it("typing filters by name, line and synonyms, matches first; a short list keeps the rest after the matches", () => {
    render(<TypeSearch choices={base} words={WORDS} />);
    fireEvent.change(box(), { target: { value: "silk" } });
    expect(tiles()[0]).toBe("textiles");
    expect(document.querySelector('[data-type="textiles"]')).toHaveAttribute("data-match");
    expect(tiles()).toEqual(["textiles", "kirana", "clinic", "other"]);
    expect(screen.queryByRole("button", { name: "Show all types" })).toBeNull(); // only for a long list
  });
  it("a long list hides the rest behind 'Show all types', and the toggle brings it back", () => {
    render(<TypeSearch choices={many} words={WORDS} />);
    fireEvent.change(box(), { target: { value: "dental" } });
    expect(tiles()).toEqual(["clinic"]);
    fireEvent.click(screen.getByRole("button", { name: "Show all types" }));
    expect(tiles()).toHaveLength(many.length);
    expect(tiles()[0]).toBe("clinic");
    fireEvent.click(screen.getByRole("button", { name: "Show only matches" }));
    expect(tiles()).toEqual(["clinic"]);
  });
  it("Enter chooses the only remaining match and never sends a form; with more than one it does nothing", () => {
    const onPick = vi.fn();
    const submit = vi.fn((e: { preventDefault: () => void }) => e.preventDefault());
    const { container } = render(<form onSubmit={submit}><TypeSearch choices={base} words={WORDS} onPick={onPick} /></form>);
    fireEvent.change(box(), { target: { value: "groc" } });
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith("kirana");
    onPick.mockClear();
    fireEvent.change(box(), { target: { value: "s" + "ilk" } });
    fireEvent.change(box(), { target: { value: "ar" } }); // Sarees, Grocery... more than one
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(onPick).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(container.querySelector('[data-type="kirana"] input')).toBeChecked();
  });
  it("no match: one plain line and a way to choose Other", () => {
    const onPick = vi.fn();
    render(<TypeSearch choices={base} words={WORDS} onPick={onPick} />);
    fireEvent.change(box(), { target: { value: "spaceship" } });
    const none = document.querySelector('[data-part="type-none"]') as HTMLElement;
    expect(none).toHaveTextContent("No business type matches that.");
    fireEvent.click(within(none).getByRole("button", { name: "Choose Other" }));
    expect(onPick).toHaveBeenCalledWith("other");
  });
  it("the chosen tile stays even when a search would hide it; the radios carry the form's field name and required", () => {
    render(<TypeSearch choices={many} words={WORDS} name="pack" required />);
    fireEvent.click(document.querySelector('[data-type="t3"] input') as HTMLElement);
    fireEvent.change(box(), { target: { value: "dental" } });
    expect(tiles()).toEqual(["clinic", "t3"]);
    const radio = document.querySelector('[data-type="clinic"] input') as HTMLInputElement;
    expect(radio.name).toBe("pack");
    expect(radio.required).toBe(true);
  });
});
