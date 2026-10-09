import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined) }) }));
vi.mock("next/font/google", () => ({ Geist: () => ({ variable: "geist" }), Geist_Mono: () => ({ variable: "mono" }) }));

import RootLayout from "./layout";

const render = async () => renderToStaticMarkup(await RootLayout({ children: <p>page</p> } as never));

describe("the root layout", () => {
  it("puts the chosen theme on <html> and nothing when there is no choice or the cookie is not ours", async () => {
    jar.clear();
    expect(await render()).not.toContain("data-theme");
    jar.set("sme_theme", "dark");
    expect(await render()).toContain('data-theme="dark"');
    jar.set("sme_theme", "light");
    expect(await render()).toContain('data-theme="light"');
    jar.set("sme_theme", "javascript:alert(1)");
    expect(await render()).not.toContain("data-theme");
  });

  it("keeps the document language and the page", async () => {
    jar.clear();
    const html = await render();
    expect(html).toContain('lang="en"');
    expect(html).toContain("<p>page</p>");
  });
});
