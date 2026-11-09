import { describe, expect, it, vi } from "vitest";

vi.mock("@/design/fonts", () => ({ v2FontClassName: () => "font-vars" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/" }));

// next/dynamic loads a chunk on the client; a test renders the real components at once
vi.mock("./LazyIslands", async () => ({ PaverCalculator: (await import("./PaverCalculator")).PaverCalculator, ContactForm: (await import("./ContactForm")).ContactForm, WaitlistForm: (await import("./WaitlistForm")).WaitlistForm, HeroStage: (await import("./home2/HeroStage")).HeroStage, CallDemo: (await import("./home2/CallDemo")).CallDemo, RadarFinder: (await import("./home2/RadarFinder")).RadarFinder, StandupTable: (await import("./home2/StandupTable")).StandupTable, Journey: (await import("./home2/Journey")).Journey, LeakCalc: (await import("./home2/LeakCalc")).LeakCalc, BrandDots: (await import("./home2/BrandDots")).BrandDots }));

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

describe("the home page (landing v2, 6 Nov 2026; the sections not yet rebuilt are still landing v3)", () => {
  const home = render("en", { kind: "home" });
  const text = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ");
  it("landing v2: the sections in the design's order, then the footer with the dot wordmark; the old landing v3 sections are gone", () => {
    const at = ["h1", "greetings", "call", "finder", "team", "after", "number", "calc", "plans", "faq", "join"].map((id) => (id === "greetings" ? home.indexOf('data-part="greetings"') : home.indexOf(`id="${id}"`))); // (without the waitlist the closing section is #join; with it, #demo)
    expect(at.every((i) => i > 0), JSON.stringify(at)).toBe(true);
    expect([...at].sort((x, y) => x - y)).toEqual(at);
    const foot = home.match(/<footer[\s\S]*?<\/footer>/)![0];
    expect(home.indexOf("<footer")).toBeGreaterThan(at[10]);
    expect(foot).toContain('data-part="home-footer"');
    expect(foot).toMatch(/<canvas[^>]*role="img"[^>]*aria-label="Stack19"/);
    for (const l of ["English", "తెలుగు", "हिन्दी", "ಕನ್ನಡ", "Back to the top", "WhatsApp +91 95023 80998"]) expect(text(foot), l).toContain(l);
    expect(foot).toContain('href="https://wa.me/919502380998?text=Hi%20Stack19%2C%20I&#x27;d%20like%20early%20access."');
    for (const gone of ["sources", "day", "leaddesk", "industries", "trust", "start"]) expect(home, gone).not.toContain(`id="${gone}"`);
    expect(home.match(/id="top"/g)).toHaveLength(1);
  });
  it("landing v2: the leak (real labelled sliders, the visitor's own estimate), the two plans ('Price at launch', the Lead Finder crossed out in Lead Desk), nine questions as native disclosures, and the closing form on joinWaitlist", () => {
    const calc = home.match(/<section id="calc"[\s\S]*?<\/section>/)![0];
    expect(calc.match(/type="range"/g)).toHaveLength(3);
    for (const id of ["h2-enq", "h2-miss", "h2-buy", "h2-avg"]) expect(calc).toContain(`for="${id}"`);
    expect(text(calc)).toContain("Not a promise, your own estimate.");
    const plans = home.match(/<section id="plans"[\s\S]*?<\/section>/)![0];
    expect(text(plans).match(/Price at launch/g)).toHaveLength(2);
    expect(plans.match(/data-plan="(workforce|leaddesk)"/g)).toHaveLength(2);
    expect(plans).toMatch(/data-plan="leaddesk"[\s\S]*data-feature="2" data-off=""/);
    expect(text(plans)).not.toMatch(/most popular|best value|recommended/i);
    const faq = home.match(/<section id="faq"[\s\S]*?<\/section>/)![0];
    expect(faq.match(/<details/g)).toHaveLength(9);
    expect(faq).not.toMatch(/<details[^>]*\sopen/);
    expect(text(faq)).toContain("What is the evening stand-up?");
    expect(text(faq)).not.toContain("KYC");
    const join = home.match(/<section id="(demo|join)"[\s\S]*?<\/section>/)![0];
    expect(text(join)).toContain("Your next enquiry deserves a call back within minutes.");
    expect(text(join)).toContain("Or WhatsApp us on +91 95023 80998");
    expect(home).not.toContain("[WHATSAPP NUMBER]");
    expect(text(join)).toContain("We call you once from our business number. No marketing messages.");
  });
  it("landing v2: the headline in two lines, each word rising out of a blur, the line under it, the trial button and Hear a call; branded Stack19 (no working name)", () => {
    const h1 = home.match(/<h1[\s\S]*?<\/h1>/)![0];
    expect(text(h1).trim()).toBe("Every enquiry answered. New customers found.");
    expect(h1.match(/class="h2-wd h2-d\d"/g)).toHaveLength(6);
    const t = text(home);
    for (const x of ["Stack19 is an AI workforce for Indian small businesses", "built to call back every enquiry from any source within minutes, in the customer's own language", "now in early access", "Hear a call", "Log in"]) expect(t, x).toContain(x);
    // no trial length and no GST until the lawyer's review (owner, 6 Nov 2026; SITE_TRIAL_COPY=1 turns them on)
    expect(t).not.toMatch(/14-day|day trial|GST included|card or UPI/);
    expect(t).toContain("Two plans, priced in rupees.");
    expect(t).toContain("Free trial at launch. Details when we open.");
    expect(t).toContain("Lead Finder: scanning nearby");
    expect(t).not.toMatch(/working name|Sme-?AI/i);
    expect(home.match(/<h1[\s>]/g)).toHaveLength(1);
  });
  it("landing v2 keeps the live page's call-first rule (owner, 6 Nov, #378): no WhatsApp-first promise and no \"Frievening\"", () => {
    expect(text(home)).not.toMatch(/WhatsApp now|carries on over WhatsApp|WhatsApp message straight away|WhatsApp to Ravi|get WhatsApp only|Here is the brochure|Frievening/);
  });
  it("landing v2: with SITE_TRIAL_COPY=1 the later words come back (the 14-day trial, GST included)", () => {
    vi.stubEnv("SITE_TRIAL_COPY", "1");
    const on = text(render("en", { kind: "home" }));
    vi.unstubAllEnvs();
    for (const x of ["Start 14-day trial", "Two plans. Rupees, GST included.", "14 days free, counted from the day your WhatsApp is connected."]) expect(on, x).toContain(x);
  });
  it("landing v2: the sticky glass header with its scroll line, the three-bar logo, Hear a call, AI team, Plans, Questions, Log in and Get early access", () => {
    const nav = home.match(/<header[\s\S]*?<\/header>/)![0];
    expect(nav).toMatch(/\[position:sticky\]/);
    expect(nav).toContain('class="h2-prog"');
    for (const href of ['href="#call"', 'href="#team"', 'href="#plans"', 'href="#faq"', 'href="/login"']) expect(nav, href).toContain(href);
    for (const x of ["Hear a call", "AI team", "Plans", "Questions", "Log in"]) expect(text(nav), x).toContain(x);
    // four links, not six (owner, 6 Nov 2026); the Lead Finder and the business number are in the footer
    for (const gone of ['href="#finder"', 'href="#number"']) expect(nav, gone).not.toContain(gone);
    expect(nav).toContain("data-mark");
    expect(nav).not.toContain("data-orb");
  });
  it("landing v2: the hero stage is in the page without script: the six sources, the Lead Finder counter, the caption, three outcomes and Try it (three businesses, six languages (no Marathi yet), real radio buttons)", () => {
    const stage = home.match(/data-part="hero-stage"[\s\S]*$/)![0];
    expect(stage.match(/data-source="\d"/g)).toHaveLength(6);
    for (const x of ["Facebook and Instagram ads", "IndiaMART, JustDial", "Your website", "WhatsApp messages", "Missed calls", "Emails, sheets, walk-ins", "Lead Finder: scanning nearby", "Called back within minutes", "Quote ready", "Shop visit booked", "Try it", "Send an enquiry"]) expect(text(stage), x).toContain(x);
    expect(stage.match(/data-try-biz=/g)).toHaveLength(6); // the desktop bar and the phone card
    expect(stage.match(/data-try-lang=/g)).toHaveLength(12); // six languages, twice (no Marathi in Try it until it has a call voice; owner, 6 Nov 2026)
    expect(stage).not.toContain('data-try-lang="mr"');
    expect(stage).toMatch(/role="radio" aria-checked="true"[^>]*data-try-biz="saree"/);
    expect(stage).toContain('aria-live="polite"');
    expect(stage).toMatch(/<canvas[^>]*aria-hidden="true"/);
    expect(stage).not.toMatch(/data-hear=/); // no "Hear it" until the voices' manifest says a clip may be heard
  });
  it("landing v2: the seven greetings band (CSS only, the lit copy hidden from screen readers), then Hear a call with its three tabs and the sample call in Telugu with English under it", () => {
    const band = home.match(/data-part="greetings"[\s\S]*?<\/section>/)![0];
    for (const g of ["నమస్కారం", "வணக்கம்", "ನಮಸ್ಕಾರ", "നമസ്കാരം", "नमस्ते", "नमस्कार", "Hello"]) expect(band, g).toContain(g);
    expect(band).toContain('class="h2-gspot" aria-hidden="true"');
    const call = home.match(/<section id="call"[\s\S]*?<\/section>/)![0];
    expect(text(call)).toContain("Hear a call, or just read it.");
    expect(call.match(/role="tab"/g)).toHaveLength(3);
    expect(call).toMatch(/role="tab" aria-selected="true"[^>]*data-call-tab="saree"/);
    expect(call).toMatch(/lang="te" data-part="call-words"/);
    expect(text(call)).toContain("Hello! I am the AI assistant of Padma Silks. You asked about silk sarees, right?");
    expect(text(call)).toContain("Example calls for sample businesses. The names are made up.");
    expect(text(call)).toContain("Leads board");
    expect(call).not.toMatch(/data-hear=/);
  });
  it("landing v2: the Lead Finder radar with the four cities (Hyderabad first, its own area names), the legend and the found list", () => {
    const finder = home.match(/<section id="finder"[\s\S]*?<\/section>/)![0];
    expect(text(finder)).toContain("Coming soon: it also goes looking for your next customers.");
    expect(text(finder)).toContain("In early access.");
    expect(finder.match(/role="radio"[^>]*data-city="(Hyderabad|Bengaluru|Chennai|Vijayawada)"/g)).toHaveLength(8); // the desktop map and the phone's
    expect(finder).toMatch(/role="radio" aria-checked="true"[^>]*data-city="Hyderabad"/);
    for (const x of ["Saree retailers near Hyderabad", "Call now", "Ask you first", "Skip", "Found on this sweep"]) expect(text(finder), x).toContain(x);
    expect(text(finder)).toContain("Businesses only, never families.");
    expect(text(finder)).toContain("An example sweep for a sample saree shop.");
  });
  it("landing v2: the evening stand-up (the six helpers as real orbs around the table, subtitles, a seven-part bar, said to be an example), the journey's six stops with the calling tools' stop, and You, teaching it", () => {
    const team = home.match(/<section id="team"[\s\S]*?<\/section>/)![0];
    expect(text(team)).toContain("Every evening, your AI team meets and reports to you.");
    expect(team.match(/data-seat="\d"/g)).toHaveLength(6);
    for (const x of ["Caller", "Lead Finder", "Researcher", "Quote Writer", "Follow-up Desk", "Order Desk", "Caller is reporting", "1 of 7", "Example stand-up for a sample shop, in your language."]) expect(text(team), x).toContain(x);
    expect(team).not.toMatch(/data-hear=/);
    const after = home.match(/<section id="after"[\s\S]*?<\/section>/)![0];
    for (const x of ["Enquiry", "The call", "The quote", "The visit", "Follow-ups", "The order", "Calling tools stop here", "You, teaching it:", "Never promise delivery before Monday. Ask the budget first.", "One example enquiry for a sample business."]) expect(text(after), x).toContain(x);
    expect(after.match(/data-stop="\d"/g)).toHaveLength(6);
  });
  it("landing v2: the business number says 'KYC done online' and shows the KYC steps only with SITE_KYC_COPY=1", () => {
    const num = (html: string) => html.match(/<section id="number"[\s\S]*?<\/section>/)![0];
    const off = num(home);
    expect(off).toContain('data-kyc="off"');
    expect(text(off)).toContain("Your own business number");
    expect(text(off)).not.toMatch(/KYC|Business PAN|Udyam/);
    vi.stubEnv("SITE_KYC_COPY", "1");
    const on = num(render("en", { kind: "home" }));
    vi.unstubAllEnvs();
    expect(text(on)).toContain("Your own business number. KYC done online.");
    for (const x of ["Business PAN", "GST or Udyam", "Number live"]) expect(text(on), x).toContain(x);
    expect(on.match(/class="h2-kdot h2-kdot-\d"/g)).toHaveLength(3);
  });
  it("says nothing it cannot back: no 'live now', no data-region claim, no percentage, no invented number, no customer logos or praise, no GST claim", () => {
    // landing v2's example scenes count what the example does ("Checked 46 businesses", "0 new businesses found nearby"); every other word of the page must name no number of businesses or customers
    const t = text(home.replace(/data-part="hero-stage"[\s\S]*?data-part="try-phone"/, "").replace(/data-part="radar"[\s\S]*?<\/section>/, "").replace(/data-part="leak"[\s\S]*?<\/section>/, ""));
    expect(t).not.toMatch(/live now|stored in (india|mumbai)|\d\s?%|guarantee|testimonial|trusted by|used by|customers love|incl\w* GST|most popular/i);
    expect(t).not.toMatch(/\d[\d,]*\+?\s+(customers|businesses|leads called|calls a day)/i);
  });
  it("the older pages' words say the first call is 'right away'; the landing v2 words say 'within minutes', built to (owner, 6 Nov 2026: no measured time until the live pipeline calls)", () => {
    expect(siteDict("en")["v3.row.5.d"]).toMatch(/called right away, within your calling hours/);
    expect(siteDict("en")["h2.hero.sub"]).toMatch(/built to call back every enquiry from any source within minutes/);
    for (const lang of ["en", "te", "hi", "kn"] as const) for (const k of ["h2.hero.sub", "h2.hero.sub.phone", "h2.plans.f.1", "h2.join.title", "h2.out.1.t"] as const) expect(siteDict(lang)[k], `${lang} ${k}`).not.toMatch(/\b2 minutes|1 min 52|2 నిమిషా|2 मिनट|2 ನಿಮಿಷ|Marathi|మరాఠీ|मराठी|ಮರಾಠಿ/);
    for (const lang of ["en", "te", "hi", "kn"] as const) {
      const dict = siteDict(lang);
      for (const [k, v] of Object.entries(dict)) if (!/^(h2\.|hm\.pl\.f\.|v3\.plan|v3\.faq\.5|v3\.plans\.small)/.test(k)) expect(v, `${lang} ${k}`).not.toMatch(/\b(1|2|one|two)[- ]minutes?\b|\bminute after\b|\bwithin minutes\b|ఒక నిమిషం|2 నిమిషా|1 मिनट|2 मिनट|ಒಂದು ನಿಮಿಷ|2 ನಿಮಿಷ/i);
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
    for (const k of ["h2.hero.l1", "h2.call.title", "h2.finder.title", "h2.meet.title", "h2.leak.title", "h2.plans.ws", "h2.faq.title", "h2.join.title"] as const) expect(text(html), k).toContain(d[k].replace(/&/g, "&amp;").replace(/&amp;/g, "&"));
    expect(text(html)).not.toContain("Every enquiry answered.");
    expect(text(html)).not.toMatch(/\b(ld|v3)\.[a-z0-9_.]+\b/);
  });
});

describe("no price and no 'no card' anywhere on the public site (job CX: the owner decides prices after usage tests; the trial takes a payment method)", () => {
  it.each(cases)("%s: no amount, no price word with a number, no card claim", (_n, lang, target) => {
    // landing v2's labelled examples show a customer's own budget and the visitor's own estimate in rupees (never a price of ours): the hero stage, the sample call and the leak; every other word of every page names no amount
    const html = render(lang, target).replace(/data-part="hero-stage"[\s\S]*?data-part="try-phone"[\s\S]*?<\/section>/, "").replace(/data-part="call-demo"[\s\S]*?<\/section>/, "").replace(/data-part="leak"[\s\S]*?<\/section>/, "");
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
