import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const getLang = vi.fn(async () => "en");
vi.mock("@/i18n/get-lang", () => ({ getLang: () => getLang() }));

import NotFound from "./not-found";

describe("not-found page", () => {
  it("is generic: says nothing about workspaces, ids or permissions, and has one way out", async () => {
    const { container } = render(await NotFound());
    expect(screen.getByRole("heading", { name: "Not found" })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/permission|member|forbidden|exist|tenant|workspace id/i);
    expect(screen.getByRole("link", { name: /back to your workspaces/i })).toHaveAttribute("href", "/app");
  });
  it("is drawn in the app's look, with the owl, and in the person's language", async () => {
    const { container } = render(await NotFound());
    expect(container.querySelector('[data-ui="v2"] img[data-plush-avatar]')).not.toBeNull();
    expect(screen.getByRole("link").className).toContain("min-h-12");
    getLang.mockResolvedValueOnce("te");
    document.body.innerHTML = "";
    render(await NotFound());
    expect(screen.getByRole("heading", { level: 1 }).textContent).not.toBe("Not found");
  });
});
