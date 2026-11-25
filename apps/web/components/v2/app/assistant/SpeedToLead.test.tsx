import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appDict } from "@/i18n/app";
import { DEFAULT_SPEED_RULE, type SpeedRules } from "@/lib/outreach/speed";

import { SpeedToLead } from "./SpeedToLead";

const words = appDict("en") as Record<string, string>;
const INITIAL: SpeedRules = { default: DEFAULT_SPEED_RULE, perSource: {} };
afterEach(cleanup);

describe("How fast your assistant follows up", () => {
  it("shows the one rule in plain words with the usual 10:00 call, and every place follows it", () => {
    render(<SpeedToLead words={words} initial={INITIAL} canEdit save={vi.fn()} securityHref="/s" />);
    expect((screen.getByLabelText("In calling hours, call within") as HTMLSelectElement).value).toBe("2");
    expect(screen.getByText("10:00")).toBeTruthy();
    expect(document.querySelectorAll('[data-own="no"]')).toHaveLength(8);
    expect(screen.getByText(/never called or messaged/)).toBeTruthy();
  });
  it("saves the whole rule, including one place's own rule, and says it applies to the next enquiry", async () => {
    const save = vi.fn(async (r: SpeedRules) => ({ ok: true as const, value: r }));
    render(<SpeedToLead words={words} initial={INITIAL} canEdit save={save} securityHref="/s" />);
    fireEvent.change(screen.getByLabelText("In calling hours, call within"), { target: { value: "5" } });
    const meta = document.querySelector('[data-source="meta"]') as HTMLElement;
    fireEvent.click(within(meta).getByRole("button", { name: "Give it its own rule" }));
    fireEvent.change(within(meta).getByLabelText("In calling hours, call within"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    const sent = save.mock.calls[0][0];
    expect(sent.default.callWithinMinutes).toBe(5);
    expect(sent.perSource.meta?.callWithinMinutes).toBe(1);
    expect(await screen.findByText("Saved. The next enquiry follows this.")).toBeTruthy();
  });
  it("a place can go back to the rule above", () => {
    render(<SpeedToLead words={words} initial={{ default: DEFAULT_SPEED_RULE, perSource: { website: { ...DEFAULT_SPEED_RULE, callWithinMinutes: 10 } } }} canEdit save={vi.fn()} securityHref="/s" />);
    const site = document.querySelector('[data-source="website"]') as HTMLElement;
    expect(site.getAttribute("data-own")).toBe("yes");
    fireEvent.click(within(site).getByRole("button", { name: "Use the same as above" }));
    expect(site.getAttribute("data-own")).toBe("no");
  });
  it("turning follow-up off hides the times and says what happens instead", () => {
    render(<SpeedToLead words={words} initial={INITIAL} canEdit save={vi.fn()} securityHref="/s" />);
    fireEvent.click(screen.getAllByRole("checkbox", { name: "Follow up new enquiries by itself" })[0]);
    expect(screen.getByText("Off: new enquiries wait in your Leads until you act.")).toBeTruthy();
  });
  it("the two-step code is asked in plain words with a link; a non-owner sees the rule but cannot save", async () => {
    const save = vi.fn(async () => ({ ok: false as const, error: "mfa" as const }));
    const { rerender } = render(<SpeedToLead words={words} initial={INITIAL} canEdit save={save} securityHref="/s" />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Saving these rules needs your two-step code first.");
    rerender(<SpeedToLead words={words} initial={INITIAL} canEdit={false} save={save} securityHref="/s" />);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.getByText("Only the owner can change these rules.")).toBeTruthy();
  });
});
