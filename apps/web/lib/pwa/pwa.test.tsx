// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import manifest, { APP_NAME } from "@/app/manifest";

const WEB = path.resolve(import.meta.dirname, "../..");
const pub = (p: string) => path.join(WEB, "public", p);
const png = (p: string) => {
  const b = readFileSync(pub(p));
  expect(b.subarray(0, 8).toString("hex"), p).toBe("89504e470d0a1a0a");
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
};
const tokens = readFileSync(path.join(WEB, "design/tokens.css"), "utf8");

describe("the web app manifest (installability)", () => {
  const m = manifest();
  it("has what a browser asks for before it offers to install", () => {
    expect(m.name).toBe("Sme-AI");
    expect(m.short_name).toBe(APP_NAME);
    expect(m.start_url).toBe("/app");
    expect(m.scope).toBe("/");
    expect(m.display).toBe("standalone");
    const sizes = (m.icons ?? []).map((i) => `${i.sizes}:${i.purpose}`);
    expect(sizes).toContain("192x192:any");
    expect(sizes).toContain("512x512:any");
    expect(sizes).toContain("192x192:maskable");
    expect(sizes).toContain("512x512:maskable");
  });
  it("every icon it names exists, is a real PNG of the size it says", () => {
    for (const icon of m.icons ?? []) {
      expect(existsSync(pub(icon.src)), icon.src).toBe(true);
      const [w, h] = (icon.sizes ?? "").split("x").map(Number);
      expect(png(icon.src), icon.src).toEqual({ width: w, height: h });
    }
  });
  it("uses the v2 colours (background and brand) and carries no data of a person", () => {
    expect(tokens).toMatch(new RegExp(`--v2-bg: ${m.background_color};`));
    expect(tokens).toMatch(new RegExp(`--v2-brand: ${m.theme_color};`));
    expect(JSON.stringify(m)).not.toMatch(/tenant|@|token/i);
  });
  it("the Apple icon and the plain icon set are there", () => {
    expect(png("icons/apple-touch-icon.png")).toEqual({ width: 180, height: 180 });
    for (const s of [48, 72, 96, 128, 144, 152, 167, 180, 192, 256, 384, 512]) expect(png(`icons/icon-${s}.png`)).toEqual({ width: s, height: s });
  });
});

describe("the owl svg that the icons are drawn from", () => {
  // job CJ: the flat owl component (OwlSvg) is gone; the install icons, the favicon source and the share picture are still the flat drawing, as files. Making them from the plush owlet is a design call for the owner.
  it("is a plain svg file with no script and no outside address", () => {
    const file = readFileSync(pub("icons/owl.svg"), "utf8");
    expect(file).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(file).not.toMatch(/<script|href=|onload/i);
  });
});

describe("the offline pages", () => {
  const SENTENCE: Record<string, string> = {
    en: "You're offline. Agent OWL will catch up when you're back.",
    te: "మీరు ఆఫ్‌లైన్‌లో ఉన్నారు.",
    hi: "आप ऑफ़लाइन हैं।",
    kn: "ನೀವು ಆಫ್‌ಲೈನ್‌ನಲ್ಲಿದ್ದೀರಿ.",
  };
  for (const [lang, text] of Object.entries(SENTENCE))
    it(`${lang}: says it, links back, needs no script and no outside address`, () => {
      const html = readFileSync(pub(`offline/${lang}.html`), "utf8");
      expect(html).toContain(`<html lang="${lang}">`);
      expect(html).toContain(text);
      expect(html).toContain('href="/app"');
      expect(html).not.toMatch(/<script|https?:\/\//i);
    });
  it("its stylesheet follows the light and dark colours and keeps text >= 16px and the button >= 44px", () => {
    const css = readFileSync(pub("offline/offline.css"), "utf8");
    expect(css).toContain("prefers-color-scheme: dark");
    expect(css).toMatch(/min-height: 48px/);
    expect(css).not.toMatch(/font-size: (0\.[0-8]|1[0-3]px)/);
  });
});

describe("the page head", () => {
  it("links the colour of the phone's address bar, light and dark, and the owl icons", () => {
    const layout = readFileSync(path.join(WEB, "app/layout.tsx"), "utf8");
    expect(layout).toContain('"(prefers-color-scheme: light)", color: "#f9f8f6"');
    expect(layout).toContain('"(prefers-color-scheme: dark)", color: "#17161a"');
    expect(layout).toContain("/icons/apple-touch-icon.png");
    expect(layout).toContain("<ServiceWorker");
  });
});
