import { describe, expect, it, vi } from "vitest";

vi.mock("@/design/fonts", () => ({ v2FontClassName: () => "font-vars" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/" }));

// next/dynamic loads a chunk on the client; a test renders the real components at once
vi.mock("./LazyIslands", async () => ({ PaverCalculator: (await import("./PaverCalculator")).PaverCalculator, ContactForm: (await import("./ContactForm")).ContactForm, WaitlistForm: (await import("./WaitlistForm")).WaitlistForm }));

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
    expect(text).not.toMatch(/\b(hero|faq|pricing|nav|foot|steps|trust|owl|pack|how|security|contact|help|plan|meta|ld)\.[a-z0-9_.]+\b/); // a missing key shown as itself
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
  it("shows the calculator only on a page whose landing has one, and the children's promise only where it is", () => {
    for (const p of SITE_PACKS) {
      const html = render("en", { kind: "pack", slug: p.slug });
      expect(/id="calculator"/.test(html), `${p.slug} calculator`).toBe(Boolean(p.calculator));
      expect(/data-part="children-promise"/.test(html), `${p.slug} children`).toBe(Boolean(p.children_promise));
    }
    expect(SITE_PACKS.some((p) => p.calculator)).toBe(true);
    expect(SITE_PACKS.some((p) => p.children_promise)).toBe(true);
  });
});

describe("the home page (job DM, reworked for Lead Desk in night 4, F1)", () => {
  const home = render("en", { kind: "home" });
  const text = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
  it("has the sections in order: hero, the six steps, where leads come from, made for your business, plans, trust, last call to action, then the footer", () => {
    const at = ["h1", "how", "sources", "business", "pricing", "trust", "start"].map((id) => home.indexOf(`id="${id}"`));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((x, y) => x - y)).toEqual(at);
    expect(home.indexOf("<footer")).toBeGreaterThan(at[6]);
    for (const gone of ["workforce", "voice"]) expect(home, gone).not.toContain(`<section id="${gone}"`);
  });
  it("says the owner's headline, the 2-minute aim in calling hours, the two buttons, the trial note (14 days from the day WhatsApp is connected) and the badges, and brands itself Stack19 (no working name)", () => {
    const t = text(home);
    expect(t).toContain("Vijaya calls your leads in 2 minutes, in your customer's language, and follows up until they say yes or no.");
    expect(text(home.match(/data-part="aim"[\s\S]*?<\/p>/)![0])).toContain("Vijaya aims to call within 2 minutes, in calling hours.");
    for (const x of ["Start your 14-day trial", "See how it works", "14 days to try it, counted from the day your WhatsApp is connected", "WhatsApp and phone calls", "You approve every campaign", "Start trial", "Sign in", "Stack19"]) expect(t, x).toContain(x);
    expect(t).not.toMatch(/working name|Sme-?AI|30-day|30 day|Your AI workforce for Indian SMEs/i);
    expect(home.match(/<h1[\s>]/g)).toHaveLength(1);
  });
  it("has the sticky nav: the circle mark, How it works, Lead sources, Built for, Pricing, Sign in and Start trial (each link goes to a section that is on the page)", () => {
    const nav = home.match(/<header[\s\S]*?<\/header>/)![0];
    expect(nav).toMatch(/\[position:sticky\]/);
    for (const href of ['href="#how"', 'href="#sources"', 'href="#business"', 'href="#pricing"', 'href="/login"', 'href="/signup"']) expect(nav, href).toContain(href);
    for (const gone of ['href="#workforce"', 'href="#voice"']) expect(nav, gone).not.toContain(gone);
    for (const m of nav.matchAll(/href="#([a-z-]+)"/g)) expect(home, m[1]).toContain(`id="${m[1]}"`);
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
  it("has the six steps of Lead Desk in order, and the one honest line about calling hours, consent and do-not-disturb", () => {
    const section = home.match(/<section id="how"[\s\S]*?<\/section>/)![0];
    const list = section.match(/<ol[^>]*data-part="ld-steps"[\s\S]*?<\/ol>/)![0];
    expect(list.match(/data-ld-step=/g)).toHaveLength(6);
    const titles = [...list.matchAll(/<strong[^>]*>([^<]+)<\/strong>/g)].map((m) => m[1]);
    expect(titles).toEqual(["A lead arrives", "Vijaya calls within minutes", "Details go on WhatsApp", "Outcome and reason saved", "Follow-ups until yes or no", "You see the results"]);
    expect(text(list)).toContain("only to people who gave their number to the business");
    expect(text(list)).toContain("stops at once if the customer says not to contact them");
    expect(text(list)).toContain("the leads you should call yourself");
    expect(text(section.match(/data-part="calling-rules">([\s\S]*?)<\/p>/)![1]).trim()).toBe("We call only people who gave their number to the business. We follow calling hours and do-not-disturb rules.");
  });
  it("has the lead sources as plain text chips: Meta ads, IndiaMART, JustDial, Excel and Google Sheets, your website (no logo, no picture, no link)", () => {
    const section = home.match(/<section id="sources"[\s\S]*?<\/section>/)![0];
    expect(text(section)).toContain("Works with where your leads already come from.");
    const chips = section.match(/<ul[^>]*data-part="sources"[\s\S]*?<\/ul>/)![0];
    expect([...chips.matchAll(/<li[^>]*>([^<]+)<\/li>/g)].map((m) => m[1])).toEqual(["Meta ads", "IndiaMART", "JustDial", "Excel and Google Sheets", "Your website"]);
    expect(chips).not.toMatch(/<img|<svg|<a[\s>]|<picture/);
  });
  it("has made for your business: three deep cards that keep their links (sarees, building materials, schools), and a row of nine industry chips", () => {
    const section = home.match(/<section id="business"[\s\S]*?<\/section>/)![0];
    expect(text(section)).toContain("Made for your business.");
    const cards = section.match(/<ul[^>]*data-part="pack-cards"[\s\S]*?<\/ul>/)![0];
    expect(cards.match(/data-pack-card=/g)).toHaveLength(SITE_PACKS.length);
    expect(SITE_PACKS).toHaveLength(3);
    for (const p of SITE_PACKS) expect(cards, p.slug).toContain(`href="/${p.slug}"`);
    for (const x of ["Sarees and textiles", "Building materials", "Schools", "photos on WhatsApp, then a store visit", "a quote you approve, then delivery follow-up", "a campus visit booked"]) expect(text(cards), x).toContain(x);
    const chips = section.match(/data-part="industries"[\s\S]*?<\/ul>/)![0];
    expect([...chips.matchAll(/<li[^>]*>([^<]+)<\/li>/g)].map((m) => m[1])).toEqual(["Real estate", "Coaching", "Clinics", "Insurance and loans", "Auto dealers", "Interiors and solar", "Travel", "Gyms", "Wholesale"]);
  });
  it("has the plans in two kinds, from the plans data: Lead Desk plans (Pay as you go, Lead Desk 300, Lead Desk 1,000) and Workforce plans (Starter, Growth, Business); 'Price at launch' on every card, no amount, none 'most popular'", () => {
    const plans = home.match(/<section id="pricing"[\s\S]*?<\/section>/)![0];
    const group = (kind: string) => plans.match(new RegExp(`data-plan-group="${kind}"[\\s\\S]*?(?=data-plan-group=|data-part="trust")`))![0];
    const ld = group("calls");
    const wf = group("main");
    expect(text(ld)).toContain("Lead Desk plans");
    expect(text(wf)).toContain("Workforce plans");
    expect(text(wf)).toContain("Lead Desk, plus your industry pack, lead finding and research.");
    expect(ld.match(/data-plan-card=""/g)).toHaveLength(3);
    expect(wf.match(/data-plan-card=""/g)).toHaveLength(3);
    expect([...ld.matchAll(/<h4[^>]*>([^<]+)<\/h4>/g)].map((m) => m[1])).toEqual(["Pay as you go", "Lead Desk 300", "Lead Desk 1,000"]);
    expect([...wf.matchAll(/<h4[^>]*>([^<]+)<\/h4>/g)].map((m) => m[1])).toEqual(["Starter", "Growth", "Business"]);
    expect(text(plans).match(/Price at launch/g)).toHaveLength(6);
    expect(text(plans)).toContain("Every plan starts with a 14-day trial, counted from the day your WhatsApp is connected.");
    expect(text(plans)).not.toMatch(/most popular|best value|recommended/i);
    expect(text(ld)).toContain("300 WhatsApp follow-up messages a month");
    expect(text(wf)).toContain("300 business WhatsApp messages a month");
    expect(text(plans)).toContain("Start 14-day trial");
  });
  it("has trust in plain words (four promises, you stay in control, the calling rule), a link to the security page, and the last call to action with the circle", () => {
    const trust = home.match(/<section id="trust"[\s\S]*?<\/section>/)![0];
    const band = trust.match(/data-part="trust-band"[\s\S]*?<\/ul>/)![0];
    for (const x of ["You approve every rupee", "STOP always works", "AI always labelled", "Your data kept apart"]) expect(text(band), x).toContain(x);
    expect(text(trust)).toContain("The AI never invents a price.");
    expect(text(trust)).toContain("We call only people who gave their number to the business.");
    expect(trust).toContain('href="/security"');
    const end = home.match(/<section id="start"[\s\S]*?<\/section>/)![0];
    expect(text(end)).toContain("Let Vijaya call your next lead.");
    expect(text(end)).toContain("Talk to us on WhatsApp or call");
    expect(end).toContain('data-orb="think"');
    const foot = home.match(/<footer[\s\S]*?<\/footer>/)![0];
    for (const l of ["English", "తెలుగు", "हिन्दी", "ಕನ್ನಡ"]) expect(foot, l).toContain(l);
  });
  it("says nothing it cannot back: no 'live now', no data-region claim, no percentage, no invented number, no customer logos or praise, no GST claim", () => {
    const t = text(home);
    expect(t).not.toMatch(/live now|stored in (india|mumbai)|\d\s?%|guarantee|testimonial|trusted by|used by|customers love|incl\w* GST|most popular/i);
    expect(t).not.toMatch(/\d[\d,]*\+?\s+(customers|businesses|leads called|calls a day)/i);
    // the only numbers are the 2-minute aim, the 14-day trial, the six steps, and the plan names/allowances from the plans data
    expect(t.match(/\b2 minutes\b/g)!.length).toBeGreaterThanOrEqual(2);
  });
  it("the 2 minutes is what Vijaya aims for in calling hours, never a promise (on the page, in the page description)", () => {
    expect(siteDict("en")["ld.aim"]).toBe("Vijaya aims to call within 2 minutes, in calling hours.");
    expect(siteDict("en")["meta.description"]).toMatch(/aims to call your leads within minutes, in calling hours/);
    expect(siteDict("en")["hero.sub"]).not.toMatch(/within 2 minutes/);
  });
  it("carries application data and no FAQ data or offers (there is no FAQ and no price)", () => {
    expect(home).toContain('"@type":"SoftwareApplication"');
    expect(home).not.toContain("FAQPage");
    expect(home).not.toContain("offers");
  });
});

describe("Lead Desk on the business pages and the other pages (night 4, F1)", () => {
  const text = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
  const flow = (id: string) => {
    const p = SITE_PACKS.find((x) => x.id === id)!;
    const html = render("en", { kind: "pack", slug: p.slug });
    return { html, block: html.match(/<section[^>]*id="lead-desk"[\s\S]*?<\/section>/)![0] };
  };
  it("sarees: Meta and Instagram enquiries, a call within minutes, photos on WhatsApp, a store visit", () => {
    const { block } = flow("textiles");
    expect(text(block)).toContain("How Lead Desk works for sarees");
    expect(block.match(/<li/g)).toHaveLength(4);
    for (const x of ["Meta or Instagram", "calls within minutes", "Photos of the sarees go on WhatsApp", "store visit"]) expect(text(block), x).toContain(x);
  });
  it("building materials: IndiaMART and JustDial enquiries, a call, a quote the owner approves, delivery follow-up", () => {
    const { block } = flow("construction_materials");
    expect(text(block)).toContain("How Lead Desk works for building materials");
    expect(block.match(/<li/g)).toHaveLength(4);
    for (const x of ["IndiaMART or JustDial", "calls and notes what the customer needs", "You approve the quote before it goes out", "follows up on the delivery"]) expect(text(block), x).toContain(x);
  });
  it("schools: admission enquiries, speed to lead, a campus visit booked, and the plain note that the assistant never talks about fees, marks or dues", () => {
    const { block } = flow("education");
    expect(text(block)).toContain("How Lead Desk works for schools");
    expect(block.match(/<li/g)).toHaveLength(3);
    for (const x of ["An admission enquiry arrives", "Speed to lead", "A campus visit is booked"]) expect(text(block), x).toContain(x);
    expect(text(block.match(/data-part="ld-note"[\s\S]*?<\/p>/)![0])).toContain("Vijaya never talks about fees, marks or dues");
  });
  it("the block links only to the plans page; a pack page without a block (none today) draws nothing", () => {
    for (const p of SITE_PACKS) {
      const { block } = flow(p.id);
      expect([...block.matchAll(/href="([^"]+)"/g)].map((m) => m[1])).toEqual(["/pricing"]);
    }
  });
  it("the pricing page has the two kinds of plans, Lead Desk plans first, with 'Pricing announced soon' on each and no amount", () => {
    const html = render("en", { kind: "page", page: "pricing" });
    const ld = html.match(/data-plan-group="calls"[\s\S]*?(?=data-plan-group="main")/)![0];
    const wf = html.match(/data-plan-group="main"[\s\S]*?<\/ul>\s*<p/)![0];
    expect(text(ld)).toContain("Lead Desk plans");
    expect([...ld.matchAll(/<h3[^>]*>([^<]+)<\/h3>/g)].map((m) => m[1])).toEqual(["Pay as you go", "Lead Desk 300", "Lead Desk 1,000"]);
    expect(text(wf)).toContain("Workforce plans");
    expect([...wf.matchAll(/<h3[^>]*>([^<]+)<\/h3>/g)].map((m) => m[1])).toEqual(["Starter", "Growth", "Business"]);
    expect(html.indexOf('data-plan-group="calls"')).toBeLessThan(html.indexOf('data-plan-group="main"'));
    expect(text(ld).match(/Pricing announced soon/g)).toHaveLength(3);
    expect(text(wf).match(/Pricing announced soon/g)).toHaveLength(3);
  });
  it("how it works starts with the six steps of Lead Desk, then the six AI workers of the full team", () => {
    const html = render("en", { kind: "page", page: "how-it-works" });
    expect(html.match(/data-ld-step=/g)).toHaveLength(6);
    expect(html.indexOf('data-part="ld-steps"')).toBeLessThan(html.indexOf('data-part="steps"'));
    expect(text(html)).toContain("Lead Desk is the core");
  });
  it.each(["te", "hi", "kn"] as const)("%s: the new home sections read in the language (no English headline, no raw key)", (lang) => {
    const html = render(lang, { kind: "home" });
    const d = siteDict(lang);
    for (const k of ["ld.steps.title", "ld.src.title", "ld.biz.title", "ld.plans.ld.t", "ld.plans.wf.t", "ld.trust.title"] as const) expect(text(html), k).toContain(d[k].replace(/&/g, "&amp;").replace(/&amp;/g, "&"));
    expect(text(html)).not.toContain("Made for your business");
    expect(text(html)).not.toMatch(/\bld\.[a-z0-9_.]+\b/);
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
