import { describe, expect, it, vi } from "vitest";

vi.mock("@/design/fonts", () => ({ v2FontClassName: () => "font-vars" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/" }));

// next/dynamic loads a chunk on the client; a test renders the real components at once
vi.mock("./LazyIslands", async () => ({ PaverCalculator: (await import("./PaverCalculator")).PaverCalculator, ContactForm: (await import("./ContactForm")).ContactForm }));

import { renderToStaticMarkup } from "react-dom/server";

import { LANGS, type Lang } from "@/i18n/lang";
import { siteDict } from "@/i18n/site";
import { sitePath, type SiteTarget } from "@/lib/site/paths";
import { SITE_PACKS } from "@/lib/site/packs";
import { allTargets } from "@/lib/site/routes";

import { SitePage, type SiteActions } from "./SitePage";

const actions = (chatAvailable: boolean): SiteActions => ({ contactChat: vi.fn(), quoteChat: vi.fn(), chatAvailable });
const render = (lang: Lang, target: SiteTarget, chat = true) => renderToStaticMarkup(<SitePage lang={lang} target={target} actions={actions(chat)} />);
const name = (t: SiteTarget) => (t.kind === "home" ? "home" : t.kind === "page" ? t.page : t.slug);
const cases = allTargets().flatMap((t) => LANGS.map((l) => [`${name(t)} ${l}`, l, t] as const));

describe("every page of the public site, in every language", () => {
  it.each(cases)("%s: one h1, the sign-up call to action, no raw key or placeholder, the right <html> language marker", (_n, lang, target) => {
    const html = render(lang, target);
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(html).toMatch(/href="\/signup"/);
    const text = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ");
    expect(text).not.toMatch(/\{[a-z_]+\}/); // an unfilled {placeholder}
    expect(text).not.toMatch(/\b(hero|faq|pricing|nav|foot|steps|trust|owl|pack|how|security|contact|help|plan|meta)\.[a-z0-9_.]+\b/); // a missing key shown as itself
    expect(html).toContain(`lang="${lang}"`);
  });

  it.each(cases.filter(([, l]) => l !== "en"))("%s: the page says its words are a machine draft; English does not need to", (_n, lang, target) => {
    const draft = render(lang, target);
    const en = render("en", target);
    expect(draft).toContain(siteDict(lang)["draft.banner"].replace(/&/g, "&amp;"));
    expect(en).not.toContain(siteDict("te")["draft.banner"]);
    expect(en).not.toMatch(/data-part="draft"/);
  });

  it("the header and footer link to every page in the same language, and to the other languages of this page", () => {
    const html = render("te", { kind: "page", page: "pricing" });
    for (const href of ["/te", "/te/pricing", "/te/how-it-works", "/te/security", "/te/contact", "/te/help", ...SITE_PACKS.map((p) => `/te/${p.slug}`)]) expect(html, href).toContain(`href="${href}"`);
    expect(sitePath("en", { kind: "page", page: "pricing" })).toBe("/pricing");
  });
});

describe("the business type pages come from the pack data", () => {
  it("have a page for each landing.json, with its own hero, FAQ and schema.org data", () => {
    for (const p of SITE_PACKS) {
      const html = render("en", { kind: "pack", slug: p.slug });
      expect(html).toContain(p.hero.h1.en.replace(/'/g, "&#x27;"));
      expect(html).toContain('type="application/ld+json"');
      const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1].replace(/&quot;/g, '"')));
      expect(ld.length).toBeGreaterThanOrEqual(1);
    }
  });
  it("shows the calculator only on a page whose landing has one, and the fee preview and the children's promise only where they are", () => {
    for (const p of SITE_PACKS) {
      const html = render("en", { kind: "pack", slug: p.slug });
      expect(/id="calculator"/.test(html), `${p.slug} calculator`).toBe(Boolean(p.calculator));
      expect(/data-part="fee-preview"/.test(html), `${p.slug} fee`).toBe(Boolean(p.fee_preview));
      expect(/data-part="children-promise"/.test(html), `${p.slug} children`).toBe(Boolean(p.children_promise));
    }
    expect(SITE_PACKS.some((p) => p.calculator)).toBe(true);
    expect(SITE_PACKS.some((p) => p.fee_preview)).toBe(true);
  });
});

describe("the home page (job CX)", () => {
  const home = render("en", { kind: "home" });
  const text = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'");
  it("has the eight sections in order: hero, built for, six steps, languages, calls, trial box, last call to action, then the footer", () => {
    const at = ["h1", "business", "how", "languages", "calls-h", "pricing", "start"].map((id) => home.indexOf(`id="${id}"`));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((x, y) => x - y)).toEqual(at);
    expect(home.indexOf("<footer")).toBeGreaterThan(at[6]);
  });
  it("says the approved headline, the two buttons and the three badges, and brands itself Stack19 (no working name)", () => {
    const t = text(home);
    expect(t).toContain("Every enquiry answered. Every quote sent. Every rupee followed up.");
    for (const s of ["Start your 30-day trial", "See how it works", "WhatsApp + phone calls", "Set up in one evening", "Start trial", "Sign in", "Stack19"]) expect(t, s).toContain(s);
    expect(t).not.toMatch(/working name|Sme-?AI/i);
  });
  it("has the sticky nav: the mark, How it works, Languages, Businesses, Pricing, Sign in and Start trial", () => {
    const nav = home.match(/<header[\s\S]*?<\/header>/)![0];
    expect(nav).toMatch(/\[position:sticky\]/);
    for (const href of ['href="#how"', 'href="#languages"', 'href="#business"', 'href="#pricing"', 'href="/login"', 'href="/signup"']) expect(nav, href).toContain(href);
    expect(nav).toMatch(/<svg[^>]*aria-hidden="true"/); // the Layers mark
  });
  it("shows ONE owl (the hero's: eager, high priority, a srcset with the 256 and 512 px files); the three business cards have no picture", () => {
    expect(home.match(/data-site-owl=/g)).toHaveLength(1);
    expect(home.match(/<img[^>]*fetchPriority="high"[^>]*>/g)).toHaveLength(1);
    expect(home).toMatch(/srcSet="[^"]*256w[^"]*512w/);
    expect(home.match(/<img/g)).toHaveLength(1);
    const cards = home.match(/<ul[^>]*data-part="pack-cards"[\s\S]*?<\/ul>/)![0];
    expect(cards).not.toContain("<img");
    expect(cards.match(/data-pack-card=/g)).toHaveLength(SITE_PACKS.length);
    for (const p of SITE_PACKS) expect(cards, p.slug).toContain(`href="/${p.slug}"`);
    expect(text(cards)).toContain("Try the paver calculator");
  });
  it("has six steps, each with its You: line, the first one current (aria-current), and a pause button", () => {
    const steps = home.match(/<ol[^>]*aria-label="The six steps"[\s\S]*?<\/ol>/)![0];
    expect(steps.match(/<li/g)).toHaveLength(6);
    expect(steps.match(/aria-current="step"/g)).toHaveLength(1);
    expect(text(steps).match(/You:/g)).toHaveLength(6);
    for (const w of ["Answer", "Understand", "Quote", "Follow up", "Collect", "Grow"]) expect(steps, w).toContain(w);
    expect(home).toContain("Pause the steps");
  });
  it("has the languages band: a tablist of four tabs (te, hi, kn, en), the sample chat, the note, and no moving part drawn until a script runs", () => {
    const band = home.match(/<section id="languages"[\s\S]*?<\/section>/)![0];
    expect(band).toContain('role="tablist"');
    expect(band.match(/role="tab"/g)).toHaveLength(4);
    expect(band.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(band).toContain("Sample chats");
    expect(band).toContain('role="tabpanel"');
    expect(band).toContain("Sri Lakshmi Pavers");
  });
  it("says which call features are available and which are coming soon", () => {
    const calls = home.match(/<ul[^>]*data-part="calls"[\s\S]*?<\/ul>\s*<\/section>/)![0];
    expect(calls.match(/data-calls=/g)).toHaveLength(3);
    expect(text(calls).match(/Available/g)).toHaveLength(1);
    expect(text(calls).match(/Coming soon/g)).toHaveLength(2);
    expect(text(calls)).toMatch(/says it is an AI/);
    expect(text(calls)).toMatch(/Only with your approval and within calling rules/);
  });
  it("has the trial box with its four promises and two buttons, and no price", () => {
    const box = home.match(/<section id="pricing"[\s\S]*?<\/section>/)![0];
    expect(text(box)).toContain("30-day free trial");
    expect(text(box)).toContain("Cancel before the trial ends and you pay nothing");
    for (const s of ["You approve every rupee", "STOP always works", "AI always labelled", "Your data kept apart", "Start your trial", "See all plans"]) expect(text(box), s).toContain(s);
    expect(box).toContain('href="/pricing"');
  });
  it("has the dark last call to action and the footer with the four languages", () => {
    const end = home.match(/<section id="start"[\s\S]*?<\/section>/)![0];
    expect(text(end)).toContain("Your next customer is messaging you right now.");
    expect(text(end)).toContain("Talk to us on WhatsApp or call");
    const foot = home.match(/<footer[\s\S]*?<\/footer>/)![0];
    for (const l of ["English", "తెలుగు", "हिन्दी", "ಕನ್ನಡ"]) expect(foot, l).toContain(l);
  });
  it("carries application data and no FAQ data or offers (there is no FAQ and no price)", () => {
    expect(home).toContain('"@type":"SoftwareApplication"');
    expect(home).not.toContain("FAQPage");
    expect(home).not.toContain("offers");
  });
});

describe("no price and no 'no card' anywhere on the public site (job CX: the owner decides prices after usage tests; the trial takes a payment method)", () => {
  it.each(cases)("%s: no amount, no price word with a number, no card claim", (_n, lang, target) => {
    const html = render(lang, target);
    const text = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ");
    expect(text).not.toMatch(/₹|\bRs\.?\s?\d|\bINR\b|रुपये\s?\d|\d\s?रुपये|రూపాయలు\s?\d/);
    expect(text).not.toMatch(/\bno card\b|without a card|no credit card/i);
    expect(html).not.toMatch(/"price"|priceCurrency/);
  });
});

describe("the pricing page", () => {
  const html = render("en", { kind: "page", page: "pricing" });
  const text = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ");
  it("keeps the plan names and what every plan includes, and says 'Pricing announced soon' for each plan and the setup (no amount)", () => {
    for (const s of ["Starter", "Growth", "Business", "Done-for-you setup", "Founding offer", "AI is included, under fair use", "Cancel any time"]) expect(text, s).toContain(s);
    expect(text.match(/Pricing announced soon/g)!.length).toBeGreaterThanOrEqual(4);
    expect(text).toContain("Start your trial");
    expect(text).not.toMatch(/₹/);
    expect(html).not.toMatch(/guarantee/i);
  });
});

describe("the contact and the calculator, when our WhatsApp number is not set up", () => {
  it("the contact page says so and offers no chat button", () => {
    const off = render("en", { kind: "page", page: "contact" }, false);
    const on = render("en", { kind: "page", page: "contact" }, true);
    expect(off).not.toBe(on);
    expect(off).not.toMatch(/wa\.me|\d{10,}/);
  });
});
