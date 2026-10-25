import { describe, expect, it, vi } from "vitest";

vi.mock("@/design/fonts", () => ({ v2FontClassName: () => "font-vars" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/" }));

// next/dynamic loads a chunk on the client; a test renders the real components at once
vi.mock("./LazyIslands", async () => ({ PaverCalculator: (await import("./PaverCalculator")).PaverCalculator, ContactForm: (await import("./ContactForm")).ContactForm, Workforce: (await import("./Workforce")).Workforce, NaturalCalls: (await import("./NaturalCalls")).NaturalCalls, PlansPreview: (await import("./PlansPreview")).PlansPreview }));

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

describe("the home page (job DM, the clean redesign)", () => {
  const home = render("en", { kind: "home" });
  const text = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
  it("has the sections in order: hero, workforce, how you start, built for, natural AI calls, plans, last call to action, then the footer", () => {
    const at = ["h1", "workforce", "how", "business", "voice", "pricing", "start"].map((id) => home.indexOf(`id="${id}"`));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((x, y) => x - y)).toEqual(at);
    expect(home.indexOf("<footer")).toBeGreaterThan(at[6]);
  });
  it("says the approved headline, the two buttons, the trial note (14 days from the day WhatsApp is connected) and the badges, and brands itself Stack19 (no working name)", () => {
    const t = text(home);
    expect(t).toContain("Your AI workforce for Indian SMEs.");
    for (const x of ["Start your 14-day trial", "See how it works", "14 days to try it, counted from the day your WhatsApp is connected", "WhatsApp and phone calls", "You approve every campaign", "Start trial", "Sign in", "Stack19"]) expect(t, x).toContain(x);
    expect(t).not.toMatch(/working name|Sme-?AI|30-day|30 day/i);
  });
  it("has the sticky nav: the circle mark, AI workforce, How it works, AI calls, Built for, Pricing, Sign in and Start trial", () => {
    const nav = home.match(/<header[\s\S]*?<\/header>/)![0];
    expect(nav).toMatch(/\[position:sticky\]/);
    for (const href of ['href="#workforce"', 'href="#how"', 'href="#voice"', 'href="#business"', 'href="#pricing"', 'href="/login"', 'href="/signup"']) expect(nav, href).toContain(href);
    expect(nav).toContain('data-orb="still"'); // the AI circle is the logo mark
  });
  it("draws no owl and no picture file: the circle and the icons are CSS and SVG", () => {
    expect(home).not.toMatch(/owl/i);
    expect(home.match(/<img/g)).toBeNull();
    expect(home).toContain('data-orb="speak"'); // the call card
  });
  it("has the hero example: a tablist of four conversations, one chat on a phone and a call card, all said to be made up", () => {
    const hero = home.match(/data-part="hero-demo"[\s\S]*?made-up names[^<]*<\/p>/)![0];
    expect(hero.match(/role="tab"/g)).toHaveLength(4);
    expect(hero.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(hero).toContain('role="tabpanel"');
    expect(text(hero)).toContain("AI is calling Ravi Kumar");
    expect(text(hero)).toContain("Example with made-up names. AI calls are in early access.");
  });
  it("has six AI workers in the order of the workflow, the first one current, AI calls marked early access, and the loop line", () => {
    const section = home.match(/<section id="workforce"[\s\S]*?<\/section>/)![0];
    const list = section.match(/<ol[^>]*data-part="workers"[\s\S]*?<\/ol>/)![0];
    expect(list.match(/data-worker=/g)).toHaveLength(6);
    expect(list.match(/aria-current="step"/g)).toHaveLength(1);
    const names = [...list.matchAll(/<strong[^>]*>([^<]+)<\/strong>/g)].map((m) => m[1]);
    expect(names).toEqual(["Find leads", "Research", "AI calls", "WhatsApp", "Outcome", "Follow-up"]);
    expect(text(list).match(/Early access/g)).toHaveLength(1);
    expect(text(list)).toMatch(/Stops at once if they say don't contact me/);
    expect(text(section)).toContain("Then the loop starts again");
    expect(section).toContain("Pause the example");
  });
  it("has how you start (three steps, the trial's start day and the promise that the owner stays in control)", () => {
    const section = home.match(/<section id="how"[\s\S]*?<\/section>/)![0];
    expect(section.match(/<li/g)).toHaveLength(3);
    expect(text(section)).toContain("Your 14-day trial starts the day your WhatsApp is connected, not the day you sign up.");
    expect(text(section)).toContain("The AI never invents a price.");
  });
  it("has the three business cards (no picture) and the businesses that come later", () => {
    const cards = home.match(/<ul[^>]*data-part="pack-cards"[\s\S]*?<\/ul>/)![0];
    expect(cards.match(/data-pack-card=/g)).toHaveLength(SITE_PACKS.length);
    for (const p of SITE_PACKS) expect(cards, p.slug).toContain(`href="/${p.slug}"`);
    expect(text(cards)).toContain("Try the paver calculator");
    const soon = home.match(/data-part="soon"[\s\S]*?<\/ul>/)![0];
    expect(soon.match(/<li/g)).toHaveLength(8);
    expect(text(soon)).toContain("More businesses are coming.");
  });
  it("has natural AI calls as early access: language tabs, way-of-talking tabs, a line in the language, and NO play button (voices are not live)", () => {
    const voice = home.match(/<section id="voice"[\s\S]*?<\/section>/)![0];
    expect(voice.match(/role="tablist"/g)).toHaveLength(2);
    expect(voice.match(/role="tab"/g)).toHaveLength(7);
    expect(text(voice)).toContain("early access");
    expect(voice).toContain("Vani");
    expect(voice).not.toMatch(/Hear this sample|<audio/);
  });
  it("has the plans from the plans data, no price, the early-access button for AI calling only, and no plan marked most popular", () => {
    const plans = home.match(/<section id="pricing"[\s\S]*?<\/section>/)![0];
    const cards = plans.match(/data-plan-card=""/g)!;
    expect(cards).toHaveLength(3);
    expect(text(plans)).toContain("Price at launch");
    expect(text(plans)).toContain("Every plan starts with a 14-day trial, counted from the day your WhatsApp is connected.");
    expect(text(plans)).not.toMatch(/most popular/i);
    for (const x of ["Starter", "Growth", "Business"]) expect(text(plans), x).toContain(x);
    expect(text(plans)).toContain("300 business WhatsApp messages a month");
    expect(text(plans)).toContain("Start 14-day trial");
    expect(plans).toContain('role="tablist"');
  });
  it("has four promises in plain words, and the last call to action with the circle", () => {
    const band = home.match(/data-part="trust-band"[\s\S]*?<\/ul>/)![0];
    for (const x of ["You approve every rupee", "STOP always works", "AI always labelled", "Your data kept apart"]) expect(text(band), x).toContain(x);
    const end = home.match(/<section id="start"[\s\S]*?<\/section>/)![0];
    expect(text(end)).toContain("Put your AI workforce to work.");
    expect(text(end)).toContain("Talk to us on WhatsApp or call");
    expect(end).toContain('data-orb="think"');
    const foot = home.match(/<footer[\s\S]*?<\/footer>/)![0];
    for (const l of ["English", "తెలుగు", "हिन्दी", "ಕನ್ನಡ"]) expect(foot, l).toContain(l);
  });
  it("says nothing it cannot back: no 'live now', no data-region claim, no percentage", () => {
    const t = text(home);
    expect(t).not.toMatch(/live now|stored in (india|mumbai)|\d\s?%/i);
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
    expect(text).toContain("Start 14-day trial");
    expect(text).not.toMatch(/₹/);
    expect(html).not.toMatch(/guarantee/i);
  });
});

describe("how it works (job DM): the same six AI workers as the home page", () => {
  const html = render("en", { kind: "page", page: "how-it-works" });
  const text = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const list = html.match(/<ol[^>]*data-part="steps"[\s\S]*?<\/ol>/)![0];
  it("has six steps in the order of the workflow, each with the icon of its job, and the loop line; no owl", () => {
    expect(list.match(/data-step=/g)).toHaveLength(6);
    const names = [...list.matchAll(/<h3[^>]*>[\s\S]*?<\/h3>/g)].map((m) => m[0].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    expect(names.map((n) => n.replace(/^\d /, "").replace(/ Early access$/, ""))).toEqual(["Find leads", "Research", "AI calls", "WhatsApp", "Outcome", "Follow-up"]);
    expect(list.match(/<svg/g)!.length).toBeGreaterThanOrEqual(6);
    expect(text).toContain("Then the loop starts again");
    expect(html).not.toMatch(/owl/i);
  });
  it("a school's own words for its steps are the pack's (landing.json steps), and no other business type changes a step", () => {
    const edu = SITE_PACKS.find((p) => p.id === "education")!;
    const lines = [...list.matchAll(/data-pack-step="([\w-]+)"[^>]*>([\s\S]*?)<\/li>/g)];
    const stepsOf = (slug: string) => lines.filter((m) => m[1] === slug).map((m) => m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
    expect(stepsOf(edu.slug)).toHaveLength(6);
    expect(stepsOf(edu.slug).join(" ")).toContain("never searches the web for students");
    expect(stepsOf(edu.slug).join(" ")).toContain("never written by the AI");
    for (const p of SITE_PACKS.filter((x) => !x.steps)) expect(stepsOf(p.slug).join(" "), p.slug).toBe("");
  });
  it("reads the same six steps in every language (te, hi, kn are drafts) and never an English fallback key", () => {
    for (const lang of ["te", "hi", "kn"] as const) {
      const h = render(lang, { kind: "page", page: "how-it-works" });
      expect(h.match(/<ol[^>]*data-part="steps"[\s\S]*?<\/ol>/)![0].match(/data-step=/g), lang).toHaveLength(6);
      expect(h, lang).not.toMatch(/hm\.w\.|how\.steps\./);
    }
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
