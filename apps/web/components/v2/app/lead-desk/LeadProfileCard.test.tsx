// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LeadProfileCard } from "./LeadProfileCard";
import { appT } from "@/i18n/app";
import { wordsFor } from "@/i18n/app-words";
import type { LeadProfile } from "@/lib/lead-desk/profile";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const words = wordsFor("en", ["lp."]);
const profile = (over: Partial<LeadProfile> = {}): LeadProfile => ({ need: "500 paver blocks", quantity: null, area: null, city: "Eluru", budget: null, timeline: null, urgency: "high", campaign: null, originalText: "need 500 paver blocks eluru urgent", guessed: ["city", "urgency"], duplicateOf: null, mergedCount: 0, junk: null, ...over });

afterEach(() => {
  cleanup();
  refresh.mockReset();
});

describe("LeadProfileCard", () => {
  it("marks a guessed field and fixes it with one tap", async () => {
    const fix = vi.fn().mockResolvedValue({ ok: true });
    const { container } = render(<LeadProfileCard words={words} leadId="l1" profile={profile()} canEdit fix={fix} />);
    expect(container.querySelector('[data-field="need"]')?.getAttribute("data-guessed")).toBe("0");
    const city = container.querySelector('[data-field="city"]') as HTMLElement;
    expect(city.getAttribute("data-guessed")).toBe("1");
    fireEvent.click(city.querySelector('[data-act="confirm"]') as HTMLElement);
    await waitFor(() => expect(fix).toHaveBeenCalledWith("l1", "city", "Eluru"));
    expect(refresh).toHaveBeenCalled();
  });

  it("changes a field to what the person types", async () => {
    const fix = vi.fn().mockResolvedValue({ ok: true });
    const { container } = render(<LeadProfileCard words={words} leadId="l1" profile={profile()} canEdit fix={fix} />);
    fireEvent.click((container.querySelector('[data-field="city"]') as HTMLElement).querySelector('[data-act="change"]') as HTMLElement);
    fireEvent.change(screen.getByLabelText(appT("en")("lp.f.city")), { target: { value: "Vijayawada" } });
    fireEvent.click(screen.getByRole("button", { name: appT("en")("lp.card.save") }));
    await waitFor(() => expect(fix).toHaveBeenCalledWith("l1", "city", "Vijayawada"));
  });

  it("says so when the save fails and keeps the field open", async () => {
    const fix = vi.fn().mockResolvedValue({ ok: false, error: "down" });
    const { container } = render(<LeadProfileCard words={words} leadId="l1" profile={profile()} canEdit fix={fix} />);
    fireEvent.click((container.querySelector('[data-field="city"]') as HTMLElement).querySelector('[data-act="confirm"]') as HTMLElement);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("offers no buttons to a person who may not edit, and nothing when there is nothing to show", () => {
    const { container, rerender } = render(<LeadProfileCard words={words} leadId="l1" profile={profile()} canEdit={false} fix={vi.fn()} />);
    expect(container.querySelector("[data-act]")).toBeNull();
    rerender(<LeadProfileCard words={words} leadId="l1" profile={profile({ need: null, city: null, urgency: null, originalText: null, guessed: [] })} canEdit fix={vi.fn()} />);
    expect(container.querySelector('[data-part="lead-profile"]')).toBeNull();
  });
});
