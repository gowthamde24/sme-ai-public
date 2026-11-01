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
    expect(text).not.toMatch(/\{(?!customer\}|business\})[a-z_]+\}/); // an unfilled {placeholder} (the home page's opening-line example shows {customer} and {business} as they are typed)
    expect(text).not.toMatch(/\b(hero|faq|pricing|nav|foot|steps|trust|owl|pack|how|security|contact|help|plan|meta|ld|v3)\.[a-z0-9_.]+\b/); // a missing key shown as itself
    expect(html).toContain(`lang="${lang}"`);
  });

  it.each(cases)("%s: no line, banner or note says the words are machine-written or not yet reviewed (owner, 1 Nov: that is tracked in the files only)", (_n, lang, target) => {
    const html = render(lang, target);
    expect(html).not.toMatch(/data-part="draft"/);
    expect(html).not.toMatch(/machine-written|machine written|not yet (read|checked|reviewed)|యంత్రం రాసిన|मशीन से लिखा|ಯಂತ್ರ ಬರೆದ/i);
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

describe("the home page (landing v3, night 5)", () => {
  const home = render("en", { kind: "home" });
  const text = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ");
  it("has the sections in order: hero, where leads come from, a day, Lead Desk, industries, plans, promises, questions, the closing band, then the footer", () => {
    const at = ["h1", "sources", "day", "leaddesk", "industries", "plans", "trust", "faq", "start"].map((id) => home.indexOf(`id="${id}"`));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((x, y) => x - y)).toEqual(at);
    expect(home.indexOf("<footer")).toBeGreaterThan(at[8]);
    for (const gone of ["how", "business", "pricing", "workforce", "voice"]) expect(home, gone).not.toContain(`<section id="${gone}"`);
  });
  it("says the headline in three lines (no number), what it is, the two buttons and the trial line, and brands itself Stack19 (no working name)", () => {
    const h1 = home.match(/<h1[\s\S]*?<\/h1>/)![0];
    expect([...h1.matchAll(/<span class="block">([^<]+)<\/span>/g)].map((m) => m[1])).toEqual(["Catches every lead.", "Calls them right away.", "Follows up until they decide."]);
    const t = text(home);
    for (const x of ["Stack19 is an AI workforce for Indian businesses", "Its assistant calls every lead in their own language", "Get started", "See a day with Stack19", "Telugu, Tamil, Kannada, Malayalam, Hindi and English.", "Sign in", "Get started"]) expect(t, x).toContain(x);
    expect(t).not.toMatch(/working name|Sme-?AI|30-day|30 day|within 2 minutes|in 2 minutes/i);
    expect(home.match(/<h1[\s>]/g)).toHaveLength(1);
  });
  it("has the sticky nav: the three-bar logo, How it works, Lead Desk, Industries, Pricing, Questions, Sign in and Get started (each link goes to a section that is on the page)", () => {
    const nav = home.match(/<header[\s\S]*?<\/header>/)![0];
    expect(nav).toMatch(/\[position:sticky\]/);
    for (const href of ['href="#day"', 'href="#leaddesk"', 'href="#industries"', 'href="#plans"', 'href="#faq"', 'href="/login"', 'href="/signup"']) expect(nav, href).toContain(href);
    for (const m of nav.matchAll(/href="#([a-z-]+)"/g)) expect(home, m[1]).toContain(`id="${m[1]}"`);
    expect(nav).toContain("data-mark"); // the logo is three bars, not the circle
    expect(nav).not.toContain("data-orb");
  });
  it("draws no owl, no picture file and no play or pause button; the circle is the assistant's (the hero and the closing band)", () => {
    expect(home).not.toMatch(/owl/i);
    expect(home.match(/<img/g)).toBeNull();
    expect(home).not.toMatch(/aria-pressed|role="tab"|Pause the example|Play the example/);
    expect(home).toContain('data-part="hero-orb"');
    expect(home.match(/data-orb="speak"/g)).toHaveLength(1); // the closing band
  });
  it("has the example call: Telugu lines with the English under each, a clock, the result, all said to be made up", () => {
    const call = home.match(/data-part="hero-call"[\s\S]*?made-up names[^<]*<\/p>/)![0];
    expect(call.match(/data-line=/g)).toHaveLength(4);
    expect(call.match(/lang="te"/g)).toHaveLength(4);
    expect(text(call)).toContain("Ravi Kumar");
    expect(text(call)).toContain("Hello, this is Sri Sai Homes. Do you have a minute?");
    expect(text(call)).toContain("Site visit booked, Saturday 11:00");
    expect(call).toMatch(/data-part="clock">01:48</);
    expect(text(call)).toContain("Example with made-up names. AI calls are in early access.");
  });
  it("has leads from your own lists and leads you already get, as plain text chips (no logo, no picture, no link)", () => {
    const section = home.match(/<section id="sources"[\s\S]*?<\/section>/)![0];
    const find = section.match(/data-part="find"[\s\S]*?<\/ul>/)![0];
    expect([...find.matchAll(/<li[^>]*>([^<]+)<\/li>/g)].map((m) => m[1])).toEqual(["An Excel or Google Sheets file", "A pasted list of names and numbers", "Contacts from your phone"]);
    const chips = section.match(/<ul[^>]*data-part="sources"[\s\S]*?<\/ul>/)![0];
    expect([...chips.matchAll(/<li[^>]*>([^<]+)<\/li>/g)].map((m) => m[1])).toEqual(["Your website forms", "WhatsApp", "Missed calls", "Meta lead ads", "Excel and Google Sheets import", "IndiaMART (coming soon)"]);
    expect(section).not.toMatch(/<img|<svg|<a[\s>]|<picture/);
  });
  it("has a day with Stack19: six moments in order, with the workers named and a small example under three of them", () => {
    const day = home.match(/<section id="day"[\s\S]*?<\/section>/)![0];
    const list = day.match(/<ol[^>]*data-part="day"[\s\S]*?<\/ol>/)![0];
    expect(list.match(/<li[\s>]/g)).toHaveLength(6);
    expect([...list.matchAll(/<h3[^>]*>([^<]+)<\/h3>/g)].map((m) => m[1])).toEqual(["New leads caught", "A lead arrives late", "Your assistant calls", "The outcome is saved", "Your salesperson takes over", "Follow-up, without reminders from you"]);
    expect([...list.matchAll(/<time[^>]*>([^<]+)/g)].map((m) => m[1])).toEqual(["6:00", "9:47", "9:30", "9:32", "9:33", "Fri"]);
    expect(text(list)).toContain("Leads from your website forms, WhatsApp, missed calls and Meta lead ads land in one list");
    expect(list.match(/<strong[^>]*>/g)!.length).toBeGreaterThanOrEqual(2);
  });
  it("has Lead Desk in five rows: approve all, tell the assistant, languages, your opening line, speed by source", () => {
    const section = home.match(/<section id="leaddesk"[\s\S]*?<\/section>/)![0];
    expect([...section.matchAll(/data-row="(\d)"/g)].map((m) => m[1])).toEqual(["1", "2", "3", "4", "5"]);
    for (const x of ["Approve a whole list in one go", "Approve all", "Tell your assistant what you need", "Talks the way your customers talk", "నమస్కారం", "வணக்கம்", "ನಮಸ್ಕಾರ", "നമസ്കാരം", "नमस्ते", "Your words open every call", "Fast, while they're still interested", "right away", "WhatsApp now, call in the morning"]) expect(text(section), x).toContain(x);
    // the opening line shows its placeholders as they are typed
    for (const v of ["{customer}", "{business}"]) expect(text(section.match(/data-part="opening-example"[\s\S]*?<\/p>/)![0])).toContain(v);
  });
  it("has the three industries as columns with their own pages (sarees, building materials, schools), four things each, and the other businesses as nine chips", () => {
    const section = home.match(/<section id="industries"[\s\S]*?<\/section>/)![0];
    expect(text(section)).toContain("Built deeper for three industries");
    const cards = section.match(/<ul[^>]*data-part="pack-cards"[\s\S]*?<\/ul>\s*<div/)![0];
    expect(cards.match(/data-pack-card=/g)).toHaveLength(SITE_PACKS.length);
    expect(SITE_PACKS).toHaveLength(3);
    for (const p of SITE_PACKS) expect(cards, p.slug).toContain(`href="/${p.slug}"`);
    for (const x of ["Sarees and textiles", "Building materials", "Schools", "Catches every enquiry, even missed calls", "Catches every builder and contractor enquiry", "Admission enquiries called the same day", "Fee reminders from your fixed templates", "never written by the AI"]) expect(text(cards), x).toContain(x);
    const chips = section.match(/data-part="industries"[\s\S]*?<\/ul>/)![0];
    expect([...chips.matchAll(/<li[^>]*>([^<]+)<\/li>/g)].map((m) => m[1])).toEqual(["Real estate", "Coaching", "Clinics", "Insurance and loans", "Auto dealers", "Interiors and solar", "Travel", "Gyms", "Wholesale"]);
  });
  it("has two ways to start, with the plan names from the plans data; 'Price at launch' on both, no amount, none 'most popular'", () => {
    const plans = home.match(/<section id="plans"[\s\S]*?<\/section>/)![0];
    expect(plans.match(/data-plan-card=""/g)).toHaveLength(2);
    expect([...plans.matchAll(/<h3[^>]*>([^<]+)<\/h3>/g)].map((m) => m[1])).toEqual(["Lead Desk", "AI workforce"]);
    expect(text(plans)).toContain("Pay as you go, Lead Desk 300 or Lead Desk 1,000");
    expect(text(plans)).toContain("Starter, Growth or Business");
    expect(text(plans).match(/Price at launch/g)).toHaveLength(2);
    expect(text(plans)).not.toMatch(/most popular|best value|recommended/i);
  });
  it("has four promises in plain words and five questions as native disclosures, then the closing band with the assistant's orb", () => {
    const trust = home.match(/<section id="trust"[\s\S]*?<\/section>/)![0];
    for (const x of ["You decide the rules", "Honest on every call", "DND respected", "Your data stays yours"]) expect(text(trust), x).toContain(x);
    const faq = home.match(/<section id="faq"[\s\S]*?<\/section>/)![0];
    expect(faq.match(/<details/g)).toHaveLength(5);
    expect(faq).not.toMatch(/<details[^>]*\sopen/);
    const end = home.match(/<section id="start"[\s\S]*?<\/section>/)![0];
    expect(text(end)).toContain("Let your assistant call your next hundred leads");
    expect(end).toContain('data-orb="speak"');
    const foot = home.match(/<footer[\s\S]*?<\/footer>/)![0];
    for (const l of ["English", "తెలుగు", "हिन्दी", "ಕನ್ನಡ"]) expect(foot, l).toContain(l);
  });
  it("uses the type scale the owner chose: Bricolage at its normal width, heavy, tight, in fluid sizes (40 px to 64 px for the headline)", () => {
    expect(home).toMatch(/<h1[^>]*font-display[^>]*font-extrabold[^>]*clamp\(40px,calc\(4vw_\+_8px\),64px\)/);
    expect(home).toMatch(/<h2[^>]*clamp\(32px,calc\(2\.6vw_\+_14px\),52px\)/);
    expect(home).not.toMatch(/wdth/i);
  });
  it("says nothing it cannot back: no 'live now', no data-region claim, no percentage, no invented number, no customer logos or praise, no GST claim", () => {
    const t = text(home);
    expect(t).not.toMatch(/live now|stored in (india|mumbai)|\d\s?%|guarantee|testimonial|trusted by|used by|customers love|incl\w* GST|most popular/i);
    expect(t).not.toMatch(/\d[\d,]*\+?\s+(customers|businesses|leads called|calls a day)/i);
  });
  it("the first call is 'right away', never a number of minutes (owner, 28 Oct: no speed claim until it is measured), in no headline, row or page description", () => {
    expect(siteDict("en")["v3.row.5.d"]).toMatch(/called right away, within your calling hours/);
    expect(siteDict("en")["meta.description"]).toMatch(/calls your leads right away, in calling hours/);
    for (const lang of ["en", "te", "hi", "kn"] as const) {
      const dict = siteDict(lang);
      for (const [k, v] of Object.entries(dict)) if (!/^(hm\.pl\.f\.|v3\.plan|v3\.faq\.5|v3\.plans\.small)/.test(k)) expect(v, `${lang} ${k}`).not.toMatch(/\b(1|2|one|two)[- ]minutes?\b|\bminute after\b|\bwithin minutes\b|ఒక నిమిషం|2 నిమిషా|1 मिनट|2 मिनट|ಒಂದು ನಿಮಿಷ|2 ನಿಮಿಷ/i);
    }
  });
  it("carries application data and no FAQ data or offers (there is no price)", () => {
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
  it("sarees: Meta lead ad and WhatsApp enquiries, a call right away, photos on WhatsApp, a store visit", () => {
    const { block } = flow("textiles");
    expect(text(block)).toContain("How Lead Desk works for sarees");
    expect(block.match(/<li/g)).toHaveLength(4);
    for (const x of ["Meta lead ad or WhatsApp", "calls right away", "Photos of the sarees go on WhatsApp", "store visit"]) expect(text(block), x).toContain(x);
  });
  it("building materials: website and WhatsApp enquiries, a call, a quote the owner approves, delivery follow-up", () => {
    const { block } = flow("construction_materials");
    expect(text(block)).toContain("How Lead Desk works for building materials");
    expect(block.match(/<li/g)).toHaveLength(4);
    for (const x of ["your website or WhatsApp", "calls and notes what the customer needs", "You approve the quote before it goes out", "follows up on the delivery"]) expect(text(block), x).toContain(x);
  });
  it("schools: admission enquiries, speed to lead, a campus visit booked, and the plain note that the assistant never talks about fees, marks or dues", () => {
    const { block } = flow("education");
    expect(text(block)).toContain("How Lead Desk works for schools");
    expect(block.match(/<li/g)).toHaveLength(3);
    for (const x of ["An admission enquiry arrives", "calls the parent right away", "A campus visit is booked"]) expect(text(block), x).toContain(x);
    expect(text(block.match(/data-part="ld-note"[\s\S]*?<\/p>/)![0])).toContain("Your assistant never talks about fees, marks or dues");
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
    for (const k of ["v3.h1.1", "v3.src.find.t", "v3.src.have.t", "v3.lead.t", "v3.ind.t", "v3.plans.t", "v3.faq.t"] as const) expect(text(html), k).toContain(d[k].replace(/&/g, "&amp;").replace(/&amp;/g, "&"));
    expect(text(html)).not.toContain("Built deeper for three industries");
    expect(text(html)).not.toMatch(/\b(ld|v3)\.[a-z0-9_.]+\b/);
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
    expect(text).toContain("Get started");
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
    expect(names.map((n) => n.replace(/^\d /, "").replace(/ Early access$/, ""))).toEqual(["Catch leads", "Research", "AI calls", "WhatsApp", "Outcome", "Follow-up"]);
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
