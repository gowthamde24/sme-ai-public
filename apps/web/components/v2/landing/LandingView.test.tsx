import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// next/font only works inside the Next build, and the router only inside a mounted app.
vi.mock("@/design/fonts", () => ({ v2FontClassName: () => "font-vars" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/" }));

import { LandingView } from "@/components/v2/landing/LandingView";
import { BRAND_NAME } from "@/design/brand";
import { fill } from "@/i18n/fill";
import { LANGS, type Lang } from "@/i18n/lang";
import { landingDict } from "@/i18n/landing";
import { legalDict } from "@/i18n/legal";
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
const NOT_ON_FIRST_RENDER = /^(meta\.|theme\.toLight|draft\.banner)/;
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
  it("the footer links to the Privacy Policy and the Terms, has a Cookie settings button, and Contact stays a plain label (job BH)", () => {
    const h = html("en");
    const footer = h.slice(h.indexOf("<footer"));
    expect(footer).toMatch(/<a[^>]*href="\/privacy"[^>]*>Privacy Policy</);
    expect(footer).toMatch(/<a[^>]*href="\/terms"[^>]*>Terms of Use</);
    expect(footer).toMatch(/<button[^>]*type="button"[^>]*>Cookie settings</);
    expect(footer).toContain(`>${en["foot.contact"]}<`);
    expect(footer).not.toMatch(new RegExp(`<a[^>]*>${en["foot.contact"].replace(/[()]/g, "\\$&")}`));
  });
  it("says in one sentence that Agent OWL is an AI assistant and that messages to customers may be written by AI and are labelled (job BH)", () => {
    for (const lang of LANGS) {
      const d = landingDict(lang);
      expect(html(lang)).toContain(d["priv.ai"]);
    }
    expect(landingDict("en")["priv.ai"]).toMatch(/AI assistant.*written by AI.*labelled/);
  });
  it("the legal links are in each language's words", () => {
    for (const lang of ["te", "hi", "kn"] as const) {
      const footer = html(lang).slice(html(lang).indexOf("<footer"));
      expect(footer).toContain(legalDict(lang)["legal.privacy.name"]);
      expect(footer).toContain(legalDict(lang)["legal.cookies.link"]);
    }
  });
  for (const lang of LANGS) {
    it(`${lang}: the rendered page makes no claim we cannot prove`, () => {
      const rendered = text(html(lang));
      for (const [re, label] of FORBIDDEN_CLAIMS) expect(re.test(rendered), `${lang} contains ${label}`).toBe(false);
    });
  }
  it("names no customer, no person and no logo: the example conversation is labelled and has no name", () => {
    const rendered = text(html("en"));
    expect(rendered).toContain(en["chat.example"]);
    expect(rendered).not.toMatch(/Pooja|Ananya|Lakshmi|Sample Silks|Example Textiles/);
    expect(html("en").replace(/<img[^>]*owlet-full-512\.webp[^>]*>/g, "")).not.toMatch(/<img/); // no picture of a person or a logo: the only one is the owl's own still
  });
  it("uses the brand constant for its name", () => {
    expect(text(html("en"))).toContain("Sme-AI");
    expect(BRAND_NAME).toBe("Sme-AI (working name)");
  });
});

describe("landing page: the saree and textile shop page (job BS)", () => {
  it("has the sections in the order a shop owner reads them, each with its anchor", () => {
    const h = html("en");
    const ids = ["shop", "whatsapp", "how", "languages", "privacy", "pricing", "faq"].map((id) => h.indexOf(`id="${id}"`));
    for (const [i, at] of ids.entries()) expect(at, `section ${i}`).toBeGreaterThan(0);
    expect([...ids].sort((a, b) => a - b)).toEqual(ids);
    expect(h).not.toContain('id="control"');
    expect(h).not.toContain('id="team"');
  });
  it("the first screen has the promise, Agent OWL (the plush owlet: its still picture from the server), and a made-up conversation that says so", () => {
    const h = html("en");
    const hero = h.slice(h.indexOf('aria-labelledby="h1"'), h.indexOf('id="shop"'));
    expect(hero).toContain(en["hero.h1"]);
    expect(hero).toMatch(/role="img" aria-label="Agent OWL, ready to help"/);
    expect(hero).toContain('data-plush="still"'); // the server sends the still picture; the layers are requested in the browser when idle
    expect(hero).toContain('src="/owl/owlet-full-512.webp"');
    expect(hero).toContain('width="512" height="512"');
    expect(hero).toContain(en["chat.example"]);
    expect(hero).toContain(en["chat.owl"]); // the owl's lines say who wrote them
  });
  it("says in what the app really does, for a saree shop: answers, shows sarees, books visits, follows up", () => {
    const rendered = text(html("en"));
    for (const k of ["shop.1.t", "shop.2.t", "shop.3.t", "shop.4.t", "shop.5.t", "shop.6.t"]) expect(rendered).toContain(en[k as keyof typeof en]);
    expect(rendered).toMatch(/saree/i);
  });
  it("has a WhatsApp safety section with six habits and no promise about what WhatsApp decides", () => {
    const h = html("en");
    const wa = h.slice(h.indexOf('id="whatsapp"'), h.indexOf('id="how"'));
    expect(wa).toContain(en["wa.title"]);
    expect((wa.match(/<h3/g) ?? []).length).toBe(6);
    expect(text(wa)).toContain(en["wa.note"]);
    expect(text(wa)).not.toMatch(/never (be )?(banned|blocked)|cannot be (banned|blocked)|100%|guarantee/i);
  });
  it("explains how it works in exactly three steps", () => {
    const h = html("en");
    const how = h.slice(h.indexOf('id="how"'), h.indexOf('id="languages"'));
    expect((how.match(/<li/g) ?? []).length).toBe(3);
  });
  it("pricing: two cards with the placeholder [PRICE], a fair-use meter in percent, no question counts and no number", () => {
    const h = html("en");
    const pricing = text(h.slice(h.lastIndexOf("<section", h.indexOf('id="pricing"')), h.indexOf('id="faq"')));
    expect((pricing.match(/\[PRICE\]/g) ?? []).length).toBeGreaterThanOrEqual(2); // the plan and the note
    expect(pricing).toContain(en["price.fair.1"]);
    expect(pricing).toMatch(/percentage/);
    expect(pricing).toMatch(/no question counts/i);
    expect(pricing).not.toMatch(/\d/); // no price, no allowance, no count of anything
    expect(pricing).not.toMatch(/₹|\$|Rs\.?\s?\d/);
    expect(h.slice(h.indexOf('id="pricing"'), h.indexOf('id="faq"'))).toContain('href="/signup"');
  });
  it("the FAQ is honest about sending: only when automatic sending is on, and money talk always waits", () => {
    const rendered = text(html("en"));
    expect(rendered).toContain(en["faq.1.a"]);
    expect(en["faq.1.a"]).toMatch(/only if you switch automatic sending on/i);
    expect(rendered).not.toMatch(/does not send anything|never sends|you send it yourself/i);
  });
  it("the sections carry their links in the header and the footer", () => {
    const h = html("en");
    for (const id of ["shop", "whatsapp", "how", "pricing", "faq"]) {
      expect(h.slice(0, h.indexOf("</header>"))).toContain(`href="#${id}"`);
      expect(h.slice(h.indexOf("<footer"))).toContain(`href="#${id}"`);
    }
  });
  it("Telugu, Hindi and Kannada say at the top that their words are a machine-written draft; English has no such note", () => {
    for (const lang of ["te", "hi", "kn"] as const) expect(html(lang)).toMatch(new RegExp(`<p role="note"[^>]*>${landingDict(lang)["draft.banner"].replaceAll("⁠", "⁠?")}`));
    expect(html("en")).not.toContain(en["draft.banner"]);
  });
  it("the language select links the page's own addresses (/, /te, /hi, /kn)", () => {
    // LangSelect is a client island: its options are in the markup
    for (const l of ["English", "తెలుగు", "हिन्दी", "ಕನ್ನಡ"]) expect(html("en")).toContain(`>${l}</option>`);
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
