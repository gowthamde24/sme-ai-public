import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TypeCombobox, type TypeGroup } from "./TypeCombobox";

const WORDS = { label: "Business type", placeholder: "Choose or search", none: "No match. Choose Other.", otherAsk: "What is your business?", otherHint: "2 to 60 letters." };
const GROUPS: TypeGroup[] = [
  { key: "deep", label: "Built especially for", options: [{ id: "textiles", name: "Saree & textile shop", tagline: "Sarees and fabric" }, { id: "school", name: "School", tagline: "Admissions and fees" }] },
  { key: "leads", label: "Lead Desk", options: [{ id: "gym", name: "Gym", tagline: "Memberships" }, { id: "clinic", name: "Clinic", tagline: "Appointments" }] },
  { key: "other", label: "Other", options: [{ id: "other", name: "Other", tagline: "Anything else" }] },
];
const box = () => screen.getByRole("combobox", { name: "Business type" });
afterEach(cleanup);

describe("the business-type list", () => {
  it("is closed until it is focused, then lists every kind in its group, with the group names", () => {
    render(<TypeCombobox groups={GROUPS} words={WORDS} otherId="other" />);
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.focus(box());
    expect(box()).toHaveAttribute("aria-expanded", "true");
    const list = screen.getByRole("listbox");
    expect(within(list).getAllByRole("group").map((g) => g.querySelector("p")?.textContent)).toEqual(["Built especially for", "Lead Desk", "Other"]);
    expect(within(list).getAllByRole("option").map((o) => o.getAttribute("data-pack-card"))).toEqual(["textiles", "school", "gym", "clinic", "other"]);
  });
  it("typing filters by name and by line, drops empty groups, and says so when nothing matches", () => {
    render(<TypeCombobox groups={GROUPS} words={WORDS} otherId="other" />);
    fireEvent.change(box(), { target: { value: "appoint" } });
    expect(within(screen.getByRole("listbox")).getAllByRole("option").map((o) => o.getAttribute("data-pack-card"))).toEqual(["clinic"]);
    expect(within(screen.getByRole("listbox")).getAllByRole("group")).toHaveLength(1);
    fireEvent.change(box(), { target: { value: "zzz" } });
    expect(within(screen.getByRole("listbox")).queryByRole("option")).toBeNull();
    expect(screen.getByText("No match. Choose Other.")).toBeInTheDocument();
    fireEvent.change(box(), { target: { value: "oth" } });
    expect(within(screen.getByRole("listbox")).getAllByRole("option").map((o) => o.getAttribute("data-pack-card"))).toEqual(["other"]);
  });
  it("a choice closes the list, shows its name, goes with the form as the field `type` and tells the parent", () => {
    const onChoose = vi.fn();
    const { container } = render(<TypeCombobox groups={GROUPS} words={WORDS} otherId="other" onChoose={onChoose} />);
    fireEvent.focus(box());
    fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: /Gym/ }));
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(box()).toHaveAttribute("placeholder", "Gym");
    expect((container.querySelector('input[name="type"]') as HTMLInputElement).value).toBe("gym");
    expect(onChoose).toHaveBeenCalledWith("gym");
  });
  it("works from the keyboard: arrows move, Enter chooses, Esc closes", () => {
    const onChoose = vi.fn();
    render(<TypeCombobox groups={GROUPS} words={WORDS} otherId="other" onChoose={onChoose} />);
    fireEvent.keyDown(box(), { key: "ArrowDown" });
    expect(box()).toHaveAttribute("aria-expanded", "true");
    expect(box()).toHaveAttribute("aria-activedescendant", expect.stringContaining("school"));
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(onChoose).toHaveBeenCalledWith("school");
    fireEvent.keyDown(box(), { key: "ArrowDown" });
    fireEvent.keyDown(box(), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
  });
  it("'Other' asks what the business is (required, 2 to 60 letters) and does not move on by itself", () => {
    const onChoose = vi.fn();
    render(<TypeCombobox groups={GROUPS} words={WORDS} otherId="other" onChoose={onChoose} />);
    fireEvent.focus(box());
    fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: /Other/ }));
    const ask = screen.getByLabelText("What is your business?");
    expect(ask).toBeRequired();
    expect(ask).toHaveAttribute("name", "other_label");
    expect(ask).toHaveAttribute("minlength", "2");
    expect(ask).toHaveAttribute("maxlength", "60");
    expect(onChoose).not.toHaveBeenCalled();
  });
  it("without askOther, 'Other' is a choice like any other (the sign-up goes on; the words are asked at set-up)", () => {
    const onChoose = vi.fn();
    render(<TypeCombobox groups={GROUPS} words={WORDS} otherId="other" askOther={false} onChoose={onChoose} />);
    fireEvent.focus(box());
    fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: /Other/ }));
    expect(onChoose).toHaveBeenCalledWith("other");
    expect(screen.queryByLabelText("What is your business?")).toBeNull();
  });
  it("starts on the kind it is given and ignores one the list does not have", () => {
    render(<TypeCombobox groups={GROUPS} words={WORDS} initial="school" />);
    expect(box()).toHaveAttribute("placeholder", "School");
    cleanup();
    const { container } = render(<TypeCombobox groups={GROUPS} words={WORDS} initial="nope" />);
    expect((container.querySelector('input[name="type"]') as HTMLInputElement).value).toBe("");
  });
});
