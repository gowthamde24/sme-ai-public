import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EarlyAccess } from "@/components/v2/landing/EarlyAccess";
import { landingT } from "@/i18n/landing";

const t = landingT("en");
const labels = { title: t("early.title"), body: t("early.body"), status: t("early.status"), nodata: t("early.nodata"), clicked: t("early.clicked") };

beforeEach(() => {
  window.location.hash = "";
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

describe("EarlyAccess is a placeholder that sends and saves nothing", () => {
  it("has no form, no field and no button, and says it is coming soon", () => {
    const { container } = render(<EarlyAccess labels={labels} />);
    expect(container.querySelector("form, input, textarea, select, button")).toBeNull();
    expect(screen.getByText(labels.status)).toBeTruthy();
    expect(labels.status).toMatch(/Coming soon/);
    expect(labels.nodata).toMatch(/No form is connected/);
  });
  it("following the link (#early-access) shows the thank-you line and moves focus, with no request of any kind", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const xhr = vi.spyOn(XMLHttpRequest.prototype, "send");
    const beacon = vi.fn();
    Object.defineProperty(navigator, "sendBeacon", { value: beacon, configurable: true });
    const { container } = render(<EarlyAccess labels={labels} />);
    expect(screen.getByRole("status").textContent).toBe("");
    act(() => {
      window.location.hash = "#early-access";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(screen.getByRole("status").textContent).toBe(labels.clicked);
    expect(labels.clicked).toMatch(/Nothing was sent or saved|nothing was sent or saved/i);
    expect(document.activeElement).toBe(container.querySelector("h2"));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhr).not.toHaveBeenCalled();
    expect(beacon).not.toHaveBeenCalled();
    expect(document.cookie).toBe("");
    expect(localStorage.length).toBe(0);
  });
});
