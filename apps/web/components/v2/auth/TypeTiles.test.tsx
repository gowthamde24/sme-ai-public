import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TypeTiles } from "./TypeTiles";
import type { TypeGroup, TypeWords } from "./TypeCombobox";

afterEach(cleanup);

const WORDS: TypeWords = { label: "Business type", placeholder: "Search", none: "Nothing found.", otherAsk: "What is your business?", otherHint: "A few words.", describeLabel: "Or describe what you sell", describeHint: "A few words.", describeButton: "Find my type", describeClosest: "Closest match", describeUse: "Use this", describeNone: "We could not match that." };
const GROUPS: TypeGroup[] = [
  { key: "retail", label: "Retail and wholesale", colour: "offer", icon: "retail", options: [{ id: "k", name: "Kirana store", tagline: "Groceries and daily needs", keywords: "grocery provision general store" }] },
  { key: "food", label: "Food", colour: "offer", icon: "food", options: [{ id: "b", name: "Bakery and sweets", tagline: "Custom orders", keywords: "bakery cake sweets mithai" }] },
  { key: "other", label: "Something else", options: [{ id: "o", name: "Something else", tagline: "" }] },
];

describe("the business-type tiles", () => {
  it("draws the types as radio tiles in their groups, none chosen", () => {
    render(<TypeTiles groups={GROUPS} words={WORDS} otherId="o" />);
    expect(screen.getByRole("heading", { name: "Retail and wholesale" })).toBeInTheDocument();
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(3);
    expect(radios.every((r) => r.getAttribute("aria-checked") === "false")).toBe(true);
  });
  it("a tile is chosen with one tap: it is marked, goes with the form and calls onChoose", () => {
    const onChoose = vi.fn();
    const { container } = render(<TypeTiles groups={GROUPS} words={WORDS} otherId="o" onChoose={onChoose} />);
    fireEvent.click(screen.getByRole("radio", { name: /Bakery and sweets/ }));
    expect(screen.getByRole("radio", { name: /Bakery and sweets/ })).toHaveAttribute("aria-checked", "true");
    expect((container.querySelector('input[name="type"]') as HTMLInputElement).value).toBe("b");
    expect(onChoose).toHaveBeenCalledWith("b");
  });
  it("the search filters by name, line and search words, and says so when nothing is left", () => {
    render(<TypeTiles groups={GROUPS} words={WORDS} otherId="o" />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "mithai" } });
    expect(screen.getAllByRole("radio")).toHaveLength(1);
    expect(screen.getByRole("radio", { name: /Bakery/ })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzz" } });
    expect(screen.getByText("Nothing found.")).toBeInTheDocument();
  });
  it("Describe what you sell suggests the closest type and the person confirms it", () => {
    const onChoose = vi.fn();
    render(<TypeTiles groups={GROUPS} words={WORDS} otherId="o" onChoose={onChoose} />);
    fireEvent.change(screen.getByLabelText("Or describe what you sell"), { target: { value: "we make cakes and mithai" } });
    fireEvent.click(screen.getByRole("button", { name: "Find my type" }));
    const box = screen.getByRole("status");
    expect(within(box).getByText("Bakery and sweets")).toBeInTheDocument();
    expect(onChoose).not.toHaveBeenCalled();
    fireEvent.click(within(box).getByRole("button", { name: "Use this" }));
    expect(onChoose).toHaveBeenCalledWith("b");
    expect(screen.getByRole("radio", { name: /Bakery and sweets/ })).toHaveAttribute("aria-checked", "true");
  });
  it("no match offers Something else with the description written into its text field", () => {
    render(<TypeTiles groups={GROUPS} words={WORDS} otherId="o" />);
    fireEvent.change(screen.getByLabelText("Or describe what you sell"), { target: { value: "tractor repair" } });
    fireEvent.click(screen.getByRole("button", { name: "Find my type" }));
    expect(screen.getByText("We could not match that.")).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("status")).getByRole("button", { name: "Something else" }));
    expect((screen.getByLabelText("What is your business?") as HTMLInputElement).value).toBe("tractor repair");
  });
  it("without the describe words the box is not drawn (the Settings list keeps its own control)", () => {
    const { describeLabel: _a, ...plain } = WORDS;
    void _a;
    render(<TypeTiles groups={GROUPS} words={plain} otherId="o" />);
    expect(screen.queryByLabelText("Or describe what you sell")).toBeNull();
  });
});
