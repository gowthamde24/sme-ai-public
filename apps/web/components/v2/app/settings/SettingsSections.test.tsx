import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { SettingsSections, type SectionGroup } from "./SettingsSections";

afterEach(cleanup);
const item = (key: string, current = false) => ({ key, label: key, href: `/s?section=${key}`, current });
const groups: SectionGroup[] = [
  { key: "business", label: "Business", items: [item("business", true), item("profile")] },
  { key: "team", label: "Team", items: [item("members")] },
  { key: "more", label: "More", items: [item("data"), item("security")] },
  { key: "empty", label: "Nothing", items: [] },
];

describe("Settings as a grouped list (SETTINGS_OPEN)", () => {
  it("groups in a row, the pages of the open group under it, a group with no pages is left out", () => {
    const { container } = render(<SettingsSections groups={groups} label="Parts" selectLabel="Section" />);
    const top = container.querySelectorAll("[data-part='settings-sections'] > div > ul:first-child > li");
    expect([...top].map((l) => l.textContent)).toEqual(["Business", "Team", "More"]);
    expect(container.querySelector("[aria-current='page']")?.textContent).toBe("business");
    expect(screen.getByRole("link", { name: "profile" })).toBeInTheDocument();
  });
  it("on a phone one select 'Section' with the groups as option groups; picking goes to the page", () => {
    render(<SettingsSections groups={groups} label="Parts" selectLabel="Section" />);
    const sel = screen.getByLabelText("Section") as HTMLSelectElement;
    expect(sel.querySelectorAll("optgroup")).toHaveLength(3);
    fireEvent.change(sel, { target: { value: "/s?section=security" } });
    expect(push).toHaveBeenCalledWith("/s?section=security");
  });
});
