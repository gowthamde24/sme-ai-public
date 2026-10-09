import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeButton } from "./ThemeButton";

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
  document.cookie = "sme_theme=; Max-Age=0; Path=/";
});

describe("ThemeButton keeps every v2 wrapper and <html> in step (workspace redesign)", () => {
  it("one click changes the frame, a migrated screen's wrapper and the document", () => {
    render(
      <div>
        <div data-ui="v2" data-theme="light" id="frame">
          <ThemeButton initial="light" toDark="To dark" toLight="To light" />
        </div>
        <div data-ui="v2" data-theme="light" id="screen" />
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "To dark" }));
    expect(document.getElementById("frame")?.getAttribute("data-theme")).toBe("dark");
    expect(document.getElementById("screen")?.getAttribute("data-theme")).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(document.cookie).toContain("sme_theme=dark");
    fireEvent.click(screen.getByRole("button", { name: "To light" }));
    expect(document.getElementById("screen")?.getAttribute("data-theme")).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });
});
