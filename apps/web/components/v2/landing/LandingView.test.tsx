import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// next/font only works inside the Next build, and the router only inside a mounted app.
vi.mock("@/design/fonts", () => ({ v2FontClassName: () => "font-vars" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { LandingView } from "@/components/v2/landing/LandingView";
import { BRAND_NAME } from "@/design/brand";
import { fill } from "@/i18n/fill";
import { LANGS, type Lang } from "@/i18n/lang";
import { landingDict } from "@/i18n/landing";
import { FORBIDDEN_CLAIMS } from "@/i18n/strings/forbidden";

const decode = (s: string) => s.replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
/** Visible text plus the words in attributes (aria-label, alt, title), which a screen reader reads. */
const text = (html: string) => {
  const attrs = [...html.matchAll(/(?:aria-label|alt|title)="([^"]*)"/g)].map((m) => m[1]).join(" ");
  return decode(`${html.replace(/<[^>]+>/g, " ")} ${attrs}`.replace(/\s+/g, " "));
};
const html = (lang: Lang, theme?: "light" | "dark") => renderToStaticMarkup(<LandingView lang={lang} theme={theme} />);
const en = landingDict("en");
/** A template with {vars} as a pattern: the page shows it with real values filled in. */
const shows = (rendered: string, template: string) => {
  const esc = fill(template).replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{\w+\}/g, ".+?");
  return new RegExp(esc).test(rendered);
};
// strings that show only after an action, in <head> (route metadata), or in the other state of a toggle
const NOT_ON_FIRST_RENDER = /^(meta\.|early\.clicked|anim\.(play|motionPlay|motionStop)|theme\.toLight)/;
const ALLOWED_SAME = /^(langs\.sample\.en)/;

describe("landing page: every string of the store is on the page", () => {
  it("English shows every string that is not state-specific, with its variables filled in", () => {
    const rendered = text(html("en"));
    const missing = Object.entries(en)
      .filter(([k]) => !NOT_ON_FIRST_RENDER.test(k))
      .filter(([, v]) => !shows(rendered, v))
      .map(([k]) => k);
    expect(missing).toEqual([]);
  });
  for (const lang of ["te", "hi", "kn"] as const) {
    it(`${lang}: no English sentence from the page leaks through, and the page is in that language`, () => {
      const rendered = text(html(lang));
      const leaks = Object.entries(en)
        .filter(([k, v]) => v.length > 14 && /[A-Za-z]{3}/.test(v) && !ALLOWED_SAME.test(k) && !/\{/.test(v))
        .filter(([, v]) => rendered.includes(v))
        .map(([k]) => k);
      expect(leaks).toEqual([]);
      const script = { te: /[ఀ-౿]/, hi: /[ऀ-ॿ]/, kn: /[ಀ-೿]/ }[lang];
      expect(rendered).toMatch(script);
      expect(rendered).not.toContain("Request early access");
    });
    it(`${lang}: every string of the store (except state-specific ones) is shown`, () => {
      const rendered = text(html(lang));
      const dict = landingDict(lang);
      const missing = Object.entries(dict)
        .filter(([k]) => !NOT_ON_FIRST_RENDER.test(k) && !/^(foot\.copy|langs\.sample\.)/.test(k))
        .filter(([, v]) => !shows(rendered, v.replaceAll("⁠", "")) && !shows(rendered, v))
        .map(([k]) => k);
      expect(missing).toEqual([]);
    });
  }
});

describe("landing page: structure and honesty", () => {
  it("has one h1 and a clean heading order", () => {
    const h = html("en");
    expect((h.match(/<h1[ >]/g) ?? []).length).toBe(1);
    const levels = [...h.matchAll(/<h([1-6])[ >]/g)].map((m) => Number(m[1]));
    for (let i = 1; i < levels.length; i++) expect(levels[i] - levels[i - 1], `heading ${i}`).toBeLessThanOrEqual(1);
  });
  it("uses landmarks, has a skip link first, and has no form, no input and no external address", () => {
    const h = html("en");
    for (const tag of ["<header", "<main", "<section", "<footer", "<nav"]) expect(h).toContain(tag);
    expect(h.indexOf('href="#main"')).toBeLessThan(h.indexOf("<header"));
    expect(h).not.toMatch(/<form|<input|<textarea|<script/);
    expect(h).not.toMatch(/href="https?:\/\//);
    expect(h).toContain('href="/login"');
  });
  it("declares the content language and the explicit theme on the wrapper, and follows the system without one", () => {
    expect(html("te")).toMatch(/<div data-ui="v2"[^>]* lang="te"/);
    expect(html("en", "dark")).toContain('data-theme="dark"');
    expect(html("en")).not.toContain("data-theme");
  });
  it("the hero flow has all six steps with their cards in the markup, and draft states say a person approves", () => {
    const h = html("en");
    const strip = h.slice(h.indexOf('data-mode="strip"'), h.indexOf('data-mode="swipe"'));
    for (let i = 0; i < 6; i++) expect(strip, `card ${i}`).toContain(`data-card="${i}"`);
    expect((strip.match(/Draft, a person approves/g) ?? []).length).toBe(2); // the quote draft and the follow-up draft
    expect(strip).toContain("Money still held");
  });
  it("labels every made-up example: the flow (both layouts) and the money-held note", () => {
    const h = html("en");
    const label = en["flow.example"];
    expect(label).toBe("Example, not real data");
    const stripStart = h.indexOf('data-mode="strip"');
    const swipeStart = h.indexOf('data-mode="swipe"');
    const blocks = { strip: h.slice(stripStart, swipeStart), swipe: h.slice(swipeStart, h.indexOf('id="problem"')) };
    for (const [mode, block] of Object.entries(blocks)) expect(block, mode).toContain(label);
    const control = h.slice(h.indexOf('id="control"'), h.indexOf('id="team"'));
    expect(control).toContain("₹7,820.00");
    expect(control).toContain(label);
    const amounts = (h.match(/₹[\d,]+(\.\d\d)?/g) ?? []).length;
    expect(amounts).toBeGreaterThan(0);
    expect((h.match(new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length).toBeGreaterThanOrEqual(3);
  });
  it("has no Play button in the normal case: only a small pause control", () => {
    const h = html("en");
    expect(h).not.toContain("Play animation");
    expect(h).not.toContain("Play motion");
    expect(h).toContain('aria-label="Pause animation"');
  });
  it("the footer's privacy, terms and contact entries are plain text labelled (placeholder), not links", () => {
    const h = html("en");
    const footer = h.slice(h.indexOf("<footer"));
    for (const k of ["foot.privacy", "foot.terms", "foot.contact"] as const) {
      expect(en[k]).toMatch(/\(placeholder\)/);
      expect(footer).toContain(`>${en[k]}<`);
      expect(footer).not.toMatch(new RegExp(`<a[^>]*>${en[k].replace(/[()]/g, "\\$&")}`));
    }
  });
  for (const lang of LANGS) {
    it(`${lang}: the rendered page makes no claim we cannot prove`, () => {
      const rendered = text(html(lang));
      for (const [re, label] of FORBIDDEN_CLAIMS) expect(re.test(rendered), `${lang} contains ${label}`).toBe(false);
    });
  }
  it("names no customer, no person and no logo: the only business name is the labelled example", () => {
    const rendered = text(html("en"));
    expect(rendered).toContain("Example Textiles");
    expect(rendered).not.toMatch(/Pooja|Ananya|Lakshmi|Sample Silks/);
    expect(html("en")).not.toMatch(/<img/);
  });
  it("uses the brand constant for its name", () => {
    expect(text(html("en"))).toContain("Sme-AI");
    expect(BRAND_NAME).toBe("Sme-AI (working name)");
  });
});

describe("landing page: client bundle guard", () => {
  const root = path.resolve(import.meta.dirname, "../../..");
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  it("no client component imports the dictionaries (they would land in the browser bundle)", () => {
    const clients = walk(path.join(root, "components/v2")).filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f) && /^["']use client["']/.test(fs.readFileSync(f, "utf8").trimStart()));
    expect(clients.length).toBeGreaterThanOrEqual(5);
    const bad = clients.filter((f) => /@\/i18n\/(landing|strings)|strings\/.*\.json/.test(fs.readFileSync(f, "utf8"))).map((f) => path.relative(root, f));
    expect(bad).toEqual([]);
  });
});
