import fs from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { htmlText } from "@/test/html-text";

vi.mock("@/design/fonts", () => ({ v2FontClassName: () => "font-vars", teluguFontVariable: "te-font" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/" }));

// next/dynamic loads a chunk on the client; a test renders the real components at once
vi.mock("./LazyIslands", async () => ({ PaverCalculator: (await import("./PaverCalculator")).PaverCalculator, ContactForm: (await import("./ContactForm")).ContactForm, WaitlistForm: (await import("./WaitlistForm")).WaitlistForm, BrandDots: (await import("./home2/BrandDots")).BrandDots }));

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
    const text = htmlText(html);
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

describe("the home page (19 Nov 2026: one page for every width, no business named or linked)", () => {
  const home = render("en", { kind: "home" });
  const text = (html: string) => htmlText(html).replace(/\s+/g, " ");
  it("the sections in order: hero, what should your assistant do, how it works, voices, built in, plans, the final call to action, then the footer with the dot wordmark", () => {
    const at = ["h1", "ask", "how", "voices", "built", "plans", "join"].map((id) => home.indexOf(`id="${id}"`)); // (without the waitlist the closing section is #join; with it, #demo)
    expect(at.every((i) => i > 0), JSON.stringify(at)).toBe(true);
    expect([...at].sort((x, y) => x - y)).toEqual(at);
    const foot = home.match(/<footer[\s\S]*?<\/footer>/)![0];
    expect(home.indexOf("<footer")).toBeGreaterThan(at[6]);
    expect(foot).toContain('data-part="home-footer"');
    expect(foot).toMatch(/<canvas[^>]*role="img"[^>]*aria-label="Stack19"/);
    for (const l of ["English", "తెలుగు", "हिन्दी", "ಕನ್ನಡ", "Back to the top", "WhatsApp +91 95023 80998"]) expect(text(foot), l).toContain(l);
    expect(foot).toContain('href="https://wa.me/919502380998?text=Hi%20Stack19%2C%20I&#x27;d%20like%20early%20access."');
    for (const gone of ["greetings", "call", "finder", "team", "after", "number", "calc", "faq", "sources", "day", "industries", "trust", "start"]) expect(home, gone).not.toContain(`id="${gone}"`);
    expect(home.match(/id="top"/g)).toHaveLength(1);
  });
  it("names no business and links to none: no business-type page address, no list of businesses", () => {
    for (const p of SITE_PACKS) {
      expect(home, p.slug).not.toContain(`href="/${p.slug}"`);
      expect(text(home), p.slug).not.toContain(p.names.en);
    }
    expect(home).not.toMatch(/data-pack=|data-business=/);
  });
  it("the hero: one plain line, three pills, the call to action and Hear a call, and a phone with a Telugu call (the same hero at every width: one markup, nothing hidden at a width)", () => {
    const hero = home.match(/<section[^>]*aria-labelledby="h1"[\s\S]*?<\/section>/)![0];
    expect(text(hero.match(/<h1[\s\S]*?<\/h1>/)![0]).trim()).toBe("Every enquiry answered. Every call picked up.");
    for (const x of ["Stack19 is an AI assistant for your business. It answers every enquiry and call, in your customer's own language.", "Answers every enquiry in seconds", "Answers your calls day and night", "Follows up on WhatsApp", "Get free early access", "Hear a call", "Live captions", "AI assistant"]) expect(text(hero), x).toContain(x);
    expect(hero).toContain('href="#voices"');
    expect(hero.match(/<li class="h3-pill/g)).toHaveLength(3);
    expect(hero).toContain("data-pp-keep"); // the phone keeps its frame on a narrow screen too
    expect(hero).toContain("data-pp-animate"); // the bubbles rise one after another
    expect(hero).toMatch(/Padma Silks కి స్వాగతం/);
    expect(home.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(text(home)).not.toMatch(/working name|Sme-?AI/i);
  });
  it("one markup at every width: no section or part is hidden or swapped at a width (no lg:hidden, hidden md:block or max-lg:hidden pair) and the page measures no screen", () => {
    const main = home.match(/<div class="h3 [\s\S]*?<footer/)![0];
    expect(main).not.toMatch(/\b(max-)?(sm|md|lg|xl|min-\[\d+px\]):(hidden|block|flex)\b|\bhidden\b[^"]*\b(sm|md|lg|xl):/);
    const src = fs.readFileSync(path.join(__dirname, "home/HomeMain.tsx"), "utf8") + fs.readFileSync(path.join(__dirname, "home/AskBox.tsx"), "utf8");
    expect(src).not.toMatch(/matchMedia|innerWidth|useMedia|:hidden|hidden (sm|md|lg|xl):|max-(sm|md|lg|xl):/);
  });
  it("what should your assistant do: a labelled box, five example chips, a disabled microphone that says soon, and a button to sign-up; it calls no AI", () => {
    const ask = home.match(/<section id="ask"[\s\S]*?<\/section>/)![0];
    expect(text(ask)).toContain("What should your assistant do?");
    expect(ask).toMatch(/<label[^>]*class="sr-only"/);
    expect(ask.match(/data-chip="\d"/g)).toHaveLength(5);
    for (const x of ["Call every new enquiry right away", "Tell customers their order is ready", "Remind people about their store visit", "Send our festival offer to customers who said yes", "Find new shops that could buy from me", "Speaking: soon", "Set this up"]) expect(text(ask), x).toContain(x);
    expect(ask).toMatch(/data-part="ask-mic"[^>]*disabled|disabled[^>]*data-part="ask-mic"/);
    expect(ask).toMatch(/data-part="ask-go"/);
    expect(ask).toContain('href="/signup"');
  });
  it("how it works: ONE phone (the WhatsApp that follows the Telugu call, English under it) and three steps, the third with what it found out", () => {
    const how = home.match(/<section id="how"[\s\S]*?<\/section>/)![0];
    expect(how.match(/data-part="phone-preview"/g)).toHaveLength(1);
    expect(how.match(/data-step="\d"/g)).toHaveLength(3);
    for (const x of ["It answers in your customer's language", "Then it follows up on WhatsApp", "You see what it found out", "Phone call, 1 min 20 s", "Kanchi silk saree, red, for a wedding", "Saturday, 11 am"]) expect(text(how), x).toContain(x);
    expect(how).toContain("ఇవి మా red Kanchi silk sarees");
  });
  it("hear our voices: four example calls (name, language, a disabled 'Sample soon' button): no audio exists, so there is no player", () => {
    const voices = home.match(/<section id="voices"[\s\S]*?<\/section>/)![0];
    expect(voices.match(/data-voice="/g)).toHaveLength(4);
    expect([...voices.matchAll(/data-voice="(\w+)"/g)].map((m) => m[1])).toEqual(["Lakshmi", "Ravi", "Anitha", "David"]);
    expect(voices.match(/<button[^>]*disabled/g)).toHaveLength(4);
    expect(text(voices).match(/Sample soon/g)).toHaveLength(4);
    expect(voices).not.toMatch(/<audio|<source|role="slider"|aria-label="Play/);
    for (const x of ["Telugu", "Hindi", "Kannada", "English"]) expect(text(voices), x).toContain(x);
  });
  it("built in: the business number, consent and STOP, quiet hours and the four languages", () => {
    const built = home.match(/<section id="built"[\s\S]*?<\/section>/)![0];
    expect(built.match(/data-built="\d"/g)).toHaveLength(4);
    for (const x of ["Your own business number", "Consent and STOP", "Quiet hours", "Telugu, English, Hindi, Kannada"]) expect(text(built), x).toContain(x);
  });
  it("the three paid plans (Pay as you go, Pro recommended, Business: rupees + 18% GST), early access free, the extra number, a link to /pricing", () => {
    const plans = home.match(/<section id="plans"[\s\S]*?<\/section>/)![0];
    expect(plans.match(/data-plan="(payg|pro|business)"/g)).toHaveLength(3);
    expect(text(plans).match(/\+ 18% GST/g)).toHaveLength(3);
    for (const x of ["Pay as you go", "\u20b9499", "Pro", "\u20b91,999", "Recommended", "Business", "\u20b95,999", "500 minutes included", "1,500 minutes included", "Find customers: 2 searches free a month, then \u20b949 each", "Find customers: 10 searches a month, then \u20b939 each", "Find customers: 100 searches a month, then \u20b929 each", "More numbers: \u20b9299 a month each", "Free early access until paid plans start", "Early access is free. Paid plans start in February 2027", "Get free early access"]) expect(text(plans), x).toContain(x);
    expect(text(plans)).not.toMatch(/most popular|best value|unlimited|Lead Desk|AI Workforce|Price at launch/i);
    expect(plans).toContain('href="/pricing"');
  });
  it("the final call to action: the line, the WhatsApp number and the closing form on joinWaitlist", () => {
    const join = home.match(/<section id="(demo|join)"[\s\S]*?<\/section>/)![0];
    expect(text(join)).toContain("Your next enquiry could be answered in seconds.");
    expect(text(join)).toContain("Or WhatsApp us on +91 95023 80998");
    expect(home).not.toContain("[WHATSAPP NUMBER]");
    expect(text(join)).toContain("We use your details only to contact you about early access.");
  });
  it("with SITE_TRIAL_COPY=1 the trial button still leads to sign-up (the later words stay off the page body)", () => {
    vi.stubEnv("SITE_TRIAL_COPY", "1");
    const on = render("en", { kind: "home" });
    vi.unstubAllEnvs();
    expect(on).toContain('href="/signup"');
  });
  it("the sticky glass header with its scroll line, the three-bar logo, How it works, Voices, Plans, Log in and Early access; the links sit in the bar from 900 px", () => {
    const nav = home.match(/<header[\s\S]*?<\/header>/)![0];
    expect(nav).toMatch(/\[position:sticky\]/);
    expect(nav).toContain('class="h2-prog"');
    for (const href of ['href="#how"', 'href="#voices"', 'href="#plans"', 'href="/login"']) expect(nav, href).toContain(href);
    for (const x of ["How it works", "Voices", "Plans", "Log in"]) expect(text(nav), x).toContain(x);
    expect(nav).toContain("min-[900px]:flex");
    expect(nav).toContain("data-mark");
    expect(nav).not.toContain("data-orb");
  });
  it("says nothing it cannot back: no 'live now', no data-region claim, no percentage, no invented number, no customer logos or praise, no GST claim", () => {
    // the plans have their own test (18% GST and the plans' rupees are the owner's numbers); the sample call's rupees and times are labelled examples
    const t = text(home.replace(/<section id="plans"[\s\S]*?<\/section>/, ""));
    expect(t).not.toMatch(/live now|stored in (india|mumbai)|\d\s?%|guarantee|testimonial|trusted by|used by|customers love|incl\w* GST|most popular/i);
    expect(t).not.toMatch(/\d[\d,]*\+?\s+(customers|businesses|leads called|calls a day)/i);
  });
  it("no public page says 'Lead Desk' or 'AI Workforce' (owner, 19 Nov 2026): not in a heading, a title, a link, the share text or the schema.org data", () => {
    for (const [n, lang, target] of cases) {
      const html = render(lang, target);
      expect(html, n).not.toMatch(/Lead Desk|AI Workforce|AI workforce/i);
    }
  });
  it("carries application data and no FAQ data or offers (there is no price)", () => {
    expect(home).toContain('"@type":"SoftwareApplication"');
    expect(home).not.toContain("FAQPage");
    expect(home).not.toContain("offers");
  });
});

describe("The assistant's flow on the business pages and the other pages (night 4, F1; reworded 19 Nov: no product name)", () => {
  const text = (html: string) => htmlText(html).replace(/\s+/g, " ");
  const flow = (id: string) => {
    const p = SITE_PACKS.find((x) => x.id === id)!;
    const html = render("en", { kind: "pack", slug: p.slug });
    return { html, block: html.match(/<section[^>]*id="lead-desk"[\s\S]*?<\/section>/)![0] };
  };
  it("sarees: Meta lead ad and WhatsApp enquiries, a call right away, photos on WhatsApp, a store visit", () => {
    const { block } = flow("textiles");
    expect(text(block)).toContain("How your assistant works for sarees");
    expect(block.match(/<li/g)).toHaveLength(4);
    for (const x of ["Meta lead ad or WhatsApp", "calls right away", "Photos of the sarees go on WhatsApp", "store visit"]) expect(text(block), x).toContain(x);
  });
  it("building materials: website and WhatsApp enquiries, a call, a quote the owner approves, delivery follow-up", () => {
    const { block } = flow("construction_materials");
    expect(text(block)).toContain("How your assistant works for building materials");
    expect(block.match(/<li/g)).toHaveLength(4);
    for (const x of ["your website or WhatsApp", "calls and notes what the customer needs", "You approve the quote before it goes out", "follows up on the delivery"]) expect(text(block), x).toContain(x);
  });
  it("schools: admission enquiries, speed to lead, a campus visit booked, and the plain note that the assistant never talks about fees, marks or dues", () => {
    const { block } = flow("education");
    expect(text(block)).toContain("How your assistant works for schools");
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
  it("the pricing page has the three paid plans (Pay as you go, Pro, Business) with their prices, worded 'With paid plans (from February 2027)', and no old plan name", () => {
    const html = render("en", { kind: "page", page: "pricing" });
    const paid = html.match(/data-plan-group="paid"[\s\S]*?data-part="every-plan"/)![0];
    expect([...paid.matchAll(/<h3[^>]*>([^<]+)<\/h3>/g)].map((m) => m[1])).toEqual(["Pay as you go", "Pro", "Business"]);
    expect([...paid.matchAll(/data-part="plan-price"[\s\S]*?<span[^>]*>([^<]+)<\/span>/g)].map((m) => m[1])).toEqual(["\u20b9499", "\u20b91,999", "\u20b95,999"]);
    expect(text(html)).toContain("With paid plans (from February 2027)");
    expect(text(html)).not.toMatch(/Lead Desk|Workforce plans|Starter|Growth|unlimited/);
    expect(html).not.toContain('data-plan-group="calls"');
    expect(html).not.toContain('data-plan-group="main"');
  });
  it("how it works starts with the six steps, then the six AI workers of the full team", () => {
    const html = render("en", { kind: "page", page: "how-it-works" });
    expect(html.match(/data-ld-step=/g)).toHaveLength(6);
    expect(html.indexOf('data-part="ld-steps"')).toBeLessThan(html.indexOf('data-part="steps"'));
    expect(text(html)).toContain("The assistant at the core");
  });
  it.each(["te", "hi", "kn"] as const)("%s: the new home sections read in the language (no English headline, no raw key)", (lang) => {
    const html = render(lang, { kind: "home" });
    const d = siteDict(lang);
    for (const k of ["h3.hero.t", "h3.ask.title", "h3.how.title", "h3.voices.title", "h3.built.title", "h2.plans.title", "h3.final.t"] as const) expect(text(html), k).toContain(d[k].replace(/&/g, "&amp;").replace(/&amp;/g, "&"));
    expect(text(html)).not.toContain("Every enquiry answered.");
    expect(text(html)).not.toContain("One call. One WhatsApp.");
    expect(text(html)).not.toMatch(/\b(ld|v3)\.[a-z0-9_.]+\b/);
  });
});

describe("no price of ours anywhere on the public site except the three paid plans (owner's final numbers, 19 Nov 2026) and no 'no card' claim", () => {
  const OWN = new Set(["\u20b9499", "\u20b91,999", "\u20b95,999", "\u20b95", "\u20b9299", "\u20b950", "\u20b949", "\u20b939", "\u20b929"]);
  it.each(cases)("%s: no amount except the plans' own, no card claim", (_n, lang, target) => {
    // landing v2's labelled examples show a customer's own budget and the visitor's own estimate in rupees (never a price of ours): the hero stage, the sample call and the leak; the plans' own numbers are lib/site/plans.ts
    const html = render(lang, target);
    const text = htmlText(html);
    for (const amount of text.match(/\u20b9\s?\d+(?:,\d{3})*/g) ?? []) expect(OWN.has(amount.replace(/\s/g, "")), `${amount} is not one of the plans' own numbers`).toBe(true);
    expect(text).not.toMatch(/\bRs\.?\s?\d|\bINR\b|रुपये\s?\d|\d\s?रुपये|రూపాయలు\s?\d/);
    expect(text).not.toMatch(/\bno card\b|without a card|no credit card/i);
    expect(html).not.toMatch(/"price"|priceCurrency/);
  });
});

describe("the pricing page", () => {
  const html = render("en", { kind: "page", page: "pricing" });
  const text = htmlText(html);
  it("shows the three paid plans with their prices and what every plan includes, worded for paid plans from February 2027; early access is free and the button says so", () => {
    for (const x of ["Pay as you go", "\u20b9499", "Pro", "\u20b91,999", "Recommended", "Business", "\u20b95,999", "+ 18% GST", "Calls: \u20b95 a minute", "500 minutes included", "1,500 minutes included", "Find customers: 2 searches free a month, then \u20b949 each", "Find customers: 10 searches a month, then \u20b939 each", "Find customers: 100 searches a month, then \u20b929 each", "Priority set-up", "Done-for-you setup", "Founding offer", "Early access is free. Paid plans start in February 2027"]) expect(text, x).toContain(x);
    for (const x of ["1 phone number included. More numbers: \u20b9299 a month each", "Calls are billed every 30 seconds", "Calls nobody answers are free", "WhatsApp at Meta's own price, no markup from us", "No charge for AI actions", "Pay yearly and get 2 months free", "Launch prices locked for 12 months", "Start with \u20b950 free in your wallet", "from about 300 minutes a month Pro costs less than Pay as you go"]) expect(text, x).toContain(x);
    expect(text).toContain("Join early access");
    expect(text).not.toMatch(/unlimited|most popular|Lead Desk/i);
    expect(html).not.toMatch(/guarantee/i);
  });
  it("six questions as native disclosures; the paid-plan answers say 'With paid plans (from February 2027)' and the early-access ones say it is free", () => {
    const faq = html.match(/<section[^>]*id="faq"[\s\S]*?<\/section>/)![0];
    expect(text.includes("What is a minute?")).toBe(true);
    for (const q of ["What is a minute?", "What if I run out of minutes?", "Can I change my plan?", "Is GST included?", "Is there a free start?", "How do phone numbers work?"]) expect(htmlText(faq), q).toContain(q);
    expect(htmlText(faq).match(/With paid plans \(from February 2027\)/g)!.length).toBeGreaterThanOrEqual(5);
    expect(htmlText(faq)).toContain("Early access is free, so there is nothing to run out of.");
    expect(htmlText(faq)).not.toMatch(/500 minutes for|pilot/i);
  });
});

describe("how it works (job DM): the same six AI workers as the home page", () => {
  const html = render("en", { kind: "page", page: "how-it-works" });
  const text = htmlText(html).replace(/\s+/g, " ");
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

describe("free early access on the pricing page (owner's launch scope, 18 Nov)", () => {
  it("says so above the future plans when EARLY_ACCESS is on, and keeps the old note when it is off", () => {
    vi.stubEnv("EARLY_ACCESS", "1");
    expect(render("en", { kind: "page", page: "pricing" })).toContain("Free during early access");
    vi.stubEnv("EARLY_ACCESS", "");
    expect(render("en", { kind: "page", page: "pricing" })).not.toContain("use everything free while we open");
    vi.unstubAllEnvs();
  });
});
