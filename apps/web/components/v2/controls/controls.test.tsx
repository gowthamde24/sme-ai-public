import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { LangSelect } from "@/components/v2/controls/LangSelect";
import { ThemeButton } from "@/components/v2/controls/ThemeButton";

const clearCookies = () => {
  for (const c of document.cookie.split(";")) document.cookie = `${c.split("=")[0].trim()}=; Max-Age=0; Path=/`;
};
const system = (dark: boolean) => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: dark, addEventListener: vi.fn(), removeEventListener: vi.fn() });
};
beforeEach(() => {
  refresh.mockClear();
  clearCookies();
  system(false);
});
afterEach(cleanup);

describe("LangSelect", () => {
  it("lists the four languages by their own names and starts on the server's language", () => {
    render(<LangSelect lang="hi" label="Language" />);
    const select = screen.getByLabelText("Language") as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(["English", "తెలుగు", "हिन्दी", "ಕನ್ನಡ"]);
    expect(select.value).toBe("hi");
  });
  it("writes the sme_lang cookie and asks the server to render again", async () => {
    render(<LangSelect lang="en" label="Language" />);
    fireEvent.change(screen.getByLabelText("Language"), { target: { value: "te" } });
    expect(document.cookie).toContain("sme_lang=te");
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });
  it("never writes a value outside the allow-list", () => {
    render(<LangSelect lang="en" label="Language" />);
    const select = screen.getByLabelText("Language");
    fireEvent.change(select, { target: { value: "fr" } });
    expect(document.cookie).not.toContain("fr");
  });
});

describe("ThemeButton", () => {
  it("offers the opposite of the saved theme", () => {
    render(<ThemeButton initial="dark" toDark="To dark" toLight="To light" />);
    expect(screen.getByRole("button", { name: "To light" })).toBeTruthy();
  });
  it("saves sme_theme and flips data-theme on the v2 wrapper at once", () => {
    render(
      <div data-ui="v2" data-theme="light">
        <ThemeButton initial="light" toDark="To dark" toLight="To light" />
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "To dark" }));
    expect(document.cookie).toContain("sme_theme=dark");
    expect(document.querySelector('[data-ui="v2"]')?.getAttribute("data-theme")).toBe("dark");
    expect(screen.getByRole("button", { name: "To light" })).toBeTruthy();
  });
  it("with no saved choice, follows the system after mount", () => {
    system(true);
    render(<ThemeButton toDark="To dark" toLight="To light" />);
    expect(screen.getByRole("button", { name: "To light" })).toBeTruthy();
  });
});
