import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Appearance } from "./Appearance";

beforeEach(() => {
  document.cookie = "sme_theme=; Path=/; Max-Age=0";
  document.documentElement.removeAttribute("data-theme");
});
afterEach(cleanup);

describe("Appearance: Automatic, Light, Dark", () => {
  it("is Automatic by default and says so", () => {
    render(<Appearance labels={undefined} />);
    expect(screen.getByRole("button", { name: "Automatic" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Light" })).toHaveAttribute("aria-pressed", "false");
  });
  it("Light and Dark save the choice and apply it at once; Automatic forgets it", () => {
    document.body.innerHTML = "";
    render(<div data-ui="v2"><Appearance labels={undefined} /></div>);
    fireEvent.click(screen.getByRole("button", { name: "Dark" }));
    expect(document.cookie).toContain("sme_theme=dark");
    expect(document.querySelector('[data-ui="v2"]')).toHaveAttribute("data-theme", "dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(screen.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Light" }));
    expect(document.cookie).toContain("sme_theme=light");
    expect(document.querySelector('[data-ui="v2"]')).toHaveAttribute("data-theme", "light");
    fireEvent.click(screen.getByRole("button", { name: "Automatic" }));
    expect(document.cookie).not.toContain("sme_theme=light");
    expect(document.querySelector('[data-ui="v2"]')).not.toHaveAttribute("data-theme");
  });
  it("shows the words the server sent", () => {
    render(<Appearance labels={{ "frame.appearance": "రూపం", "frame.theme.dark": "డార్క్" }} />);
    expect(screen.getByText("రూపం")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "డార్క్" })).toBeInTheDocument();
  });
  it("three equal segments whose labels may wrap inside their own segment but never run under the next one: in English, Telugu, Hindi and Kannada (owner screenshot, 26 Nov 2026: 'Automatic' ran under 'Light'; measured in a browser at 260 to 360 px, light and dark: no label wider than its segment, every segment 44 px high)", async () => {
    const { appDict } = await import("@/i18n/app");
    for (const lang of ["en", "te", "hi", "kn"] as const) {
      const dict = appDict(lang) as Record<string, string>;
      const labels = Object.fromEntries(Object.entries(dict).filter(([k]) => k.startsWith("frame.")));
      const { container, unmount } = render(<Appearance labels={labels} />);
      const grid = container.querySelector("[data-pick]")!.parentElement as HTMLElement;
      expect(grid.className, lang).toContain("grid-cols-[repeat(3,minmax(0,1fr))]"); // equal widths that cannot be pushed wider by a word
      for (const b of container.querySelectorAll<HTMLElement>("[data-pick]")) {
        expect(b.className, `${lang} ${b.dataset.pick}`).toMatch(/min-w-0/);
        expect(b.className, `${lang} ${b.dataset.pick}`).toMatch(/overflow-hidden/);
        expect(b.className, `${lang} ${b.dataset.pick}`).toMatch(/\[overflow-wrap:anywhere\]/); // a long word breaks inside its segment
        expect(b.className, `${lang} ${b.dataset.pick}`).toMatch(/min-h-11/); // 44 px
      }
      unmount();
    }
  });
});

