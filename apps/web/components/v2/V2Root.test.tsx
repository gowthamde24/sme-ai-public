import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// next/font only works inside the Next build; the test replaces it with a fixed class name.
vi.mock("@/design/fonts", () => ({ v2FontClassName: "font-vars" }));

import { V2Root } from "@/components/v2/V2Root";

describe("V2Root", () => {
  it("scopes everything under data-ui=v2 and renders its children", () => {
    render(<V2Root>hello</V2Root>);
    const root = screen.getByText("hello");
    expect(root.getAttribute("data-ui")).toBe("v2");
    expect(root.className).toBe("font-vars");
    expect(root.hasAttribute("data-theme")).toBe(false);
  });
  it("applies an explicit theme, a language and extra classes, and never an inline style", () => {
    render(<V2Root theme="dark" lang="te" className="min-h-screen">x</V2Root>);
    const root = screen.getByText("x");
    expect(root.getAttribute("data-theme")).toBe("dark");
    expect(root.getAttribute("lang")).toBe("te");
    expect(root.className).toBe("font-vars min-h-screen");
    expect(root.hasAttribute("style")).toBe(false);
  });
});
