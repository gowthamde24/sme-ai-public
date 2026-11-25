import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { siteT } from "@/i18n/site";

import { PublicPlanCards } from "./PublicPlans";

/** The public Pricing page's one row "Extra calls at once: ₹149 per line per month" (26 Nov 2026): only while EXTRA_LINES is on (or `mock` on staging); the number comes from the plan facts. */
const draw = (lang: "en" | "te" = "en") => render(<PublicPlanCards t={siteT(lang)} start={{ href: "/start", label: "Start" }} />);
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("the Pricing page's extra-lines row", () => {
  it("is not there while the switch is off", () => {
    vi.stubEnv("EXTRA_LINES", "");
    const { container } = draw();
    expect(container.querySelector('[data-part="extra-lines-row"]')).toBeNull();
    expect(container.textContent).not.toMatch(/Extra calls at once/);
  });
  it.each(["1", "mock"])("is one plain row among what every plan includes while EXTRA_LINES=%s", (value) => {
    vi.stubEnv("EXTRA_LINES", value);
    const { container } = draw();
    const row = container.querySelector('[data-part="extra-lines-row"]') as HTMLElement;
    expect(row).not.toBeNull();
    expect(row).toHaveTextContent("Extra calls at once: ₹149 per line per month");
    expect(row.closest('[data-part="every-plan"]')).not.toBeNull();
  });
  it("is drawn in Telugu too (a draft for the owner's reviewer), with the same number", () => {
    vi.stubEnv("EXTRA_LINES", "1");
    const { container } = draw("te");
    expect(container.querySelector('[data-part="extra-lines-row"]')).toHaveTextContent("₹149");
  });
});
