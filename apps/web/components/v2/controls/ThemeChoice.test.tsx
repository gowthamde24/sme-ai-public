import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeChoice } from "./ThemeChoice";

const words = { system: "System", light: "Light", dark: "Dark" };

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  document.cookie = "sme_theme=; Max-Age=0; Path=/";
  document.documentElement.removeAttribute("data-theme");
});
afterEach(cleanup);

describe("ThemeChoice", () => {
  it("marks the current choice, and a click saves the cookie and flips every v2 wrapper at once", () => {
    const { container } = render(
      <div data-ui="v2" data-theme="light">
        <ThemeChoice initial="light" label="Appearance" words={words} />
      </div>,
    );
    expect(screen.getByRole("button", { name: "Light" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Dark" }));
    expect(screen.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
    expect(document.cookie).toContain("sme_theme=dark");
    expect(container.querySelector('[data-ui="v2"]')).toHaveAttribute("data-theme", "dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });
  it("System forgets the choice and follows the device", () => {
    const { container } = render(
      <div data-ui="v2" data-theme="light">
        <ThemeChoice initial="light" label="Appearance" words={words} />
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "System" }));
    expect(document.cookie).not.toContain("sme_theme=light");
    expect(container.querySelector('[data-ui="v2"]')).not.toHaveAttribute("data-theme");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark"); // the device says dark (the mock)
  });
  it("every button is at least 44px tall", () => {
    render(<ThemeChoice initial="system" label="Appearance" words={words} />);
    for (const b of screen.getAllByRole("button")) expect(b.className).toContain("min-h-11");
  });
});
