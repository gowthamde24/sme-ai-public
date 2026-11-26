import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/app" }));

import { LangSelect } from "@/components/v2/controls/LangSelect";
import { ThemeButton } from "@/components/v2/controls/ThemeButton";

import { quietSelect, topIconButton } from "./frame-style";

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(cleanup);

describe("the top bar's icon buttons (owner-approved boxy mock, 26 Nov 2026)", () => {
  it("have no border at rest, a soft grey round hover, a round focus ring and a 44px target", () => {
    for (const cls of [topIconButton, quietSelect]) {
      expect(cls).not.toMatch(/(^|\s)border(\s|$)/); // no visible border
      expect(cls).toContain("border-0");
      expect(cls).toContain("rounded-full");
      expect(cls).toContain("hover:bg-surface-2");
      expect(cls).toContain("focus-visible:rounded-full!"); // the shared focus style would square the corners
      expect(cls).toContain("min-h-[44px]");
    }
    expect(topIconButton).toContain("min-w-[44px]");
  });
  it("are not written as size-11 or min-h-11, which the density rules of ds.css shrink to 32 or 40px", () => {
    expect(topIconButton).not.toMatch(/size-11|min-h-11|min-w-11/);
    expect(quietSelect).not.toMatch(/size-11|min-h-11/);
  });
  it("the theme button and the language select take the quiet look in the app and keep the bordered control elsewhere", () => {
    render(
      <>
        <ThemeButton toDark="Switch to dark" toLight="Switch to light" className={topIconButton} />
        <LangSelect lang="en" label="Language" className={quietSelect} />
      </>,
    );
    expect(screen.getByRole("button", { name: "Switch to dark" }).className).toContain("border-0");
    expect(screen.getByRole("combobox").className).toContain("border-0");
    cleanup();
    render(<ThemeButton toDark="Switch to dark" toLight="Switch to light" />);
    expect(screen.getByRole("button", { name: "Switch to dark" }).className).toContain("border-edge");
  });
});
