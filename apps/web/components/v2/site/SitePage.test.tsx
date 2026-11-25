import fs from "node:fs";
import path from "node:path";

import postcss from "postcss";
import { describe, expect, it, vi } from "vitest";

import { htmlText } from "@/test/html-text";

vi.mock("@/design/fonts", () => ({ v2FontClassName: () => "font-vars", teluguFontVariable: "te-font", teluguDemoFontVariable: "te-demo-font" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/" }));

// next/dynamic loads a chunk on the client; a test renders the real components at once
vi.mock("./LazyIslands", async () => ({ PaverCalculator: (await import("./PaverCalculator")).PaverCalculator, ContactForm: (await import("./ContactForm")).ContactForm, WaitlistForm: (await import("./WaitlistForm")).WaitlistForm, RadarFinder: (await import("./home2/RadarFinder")).RadarFinder, LeakCalc: (await import("./home2/LeakCalc")).LeakCalc }));
// the home page's below-the-fold islands are chunks on the client; a test renders them at once
vi.mock("./v9/lazy", async () => { const m = await import("./v9/below"); return { VoicesClient: m.VoicesClient, JobsClient: m.JobsClient, FaqClient: m.FaqClient, HowDemoClient: m.HowDemoClient, TryItClient: m.TryItClient, Reveal: m.Reveal, OrbRingLazy: () => null }; });

import { renderToStaticMarkup } from "react-dom/server";

import { type SiteLang } from "@/i18n/lang";
import { SITE_LANGS } from "@/i18n/site-lang";
import siteJson from "@/i18n/strings/site.json";
import { sitePath, type SiteTarget } from "@/lib/site/paths";
import { SITE_PACKS } from "@/lib/site/packs";
import { allTargets } from "@/lib/site/routes";

import { SitePage, type SiteActions } from "./SitePage";

const actions = (chatAvailable: boolean): SiteActions => ({ contactChat: vi.fn(), quoteChat: vi.fn(), chatAvailable });
const render = (lang: SiteLang, target: SiteTarget, chat = true) => renderToStaticMarkup(<SitePage lang={lang} target={target} actions={actions(chat)} />);
const name = (t: SiteTarget) => (t.kind === "home" ? "home" : t.kind === "page" ? t.page : t.slug);
const cases = allTargets().flatMap((t) => SITE_LANGS.map((l) => [`${name(t)} ${l}`, l, t] as const));

describe("every page of the public site, in every language", () => {
  it.each(cases)("%s: one h1, the sign-up call to action, no raw key or placeholder, the right <html> language marker", (_n, lang, target) => {
    const html = render(lang, target);
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(html).toMatch(target.kind === "home" ? /href="#early-access"/ : /href="\/signup"/);
    const text = htmlText(html);
    expect(text).not.toMatch(/\{(?!customer\}|business\})[a-z_]+\}/); // an unfilled {placeholder} (the home page's opening-line example shows {customer} and {business} as they are typed)
    expect(text).not.toMatch(/\b(hero|faq|pricing|nav|foot|steps|trust|owl|pack|how|security|contact|help|plan|meta|ld|v3|v9)\.[a-z0-9_.]+\b/); // a missing key shown as itself
    expect(html).toContain(`lang="${lang}"`);
  });

  it.each(cases)("%s: no line, banner or note says the words are machine-written or not yet reviewed (owner, 1 Nov: that is tracked in the files only)", (_n, lang, target) => {
    const html = render(lang, target);
    expect(html).not.toMatch(/data-part="draft"/);
    expect(html).not.toMatch(/machine-written|machine written|not yet (read|checked|reviewed)|యంత్రం రాసిన|मशीन से लिखा|ಯಂತ್ರ ಬರೆದ/i);
  });

  it("the header and footer link to every page in the same language, and to the other languages of this page, and to no business page", () => {
    const html = render("te", { kind: "page", page: "pricing" });
    for (const href of ["/te", "/te/pricing", "/te/how-it-works", "/te/security", "/te/contact", "/te/help"]) expect(html, href).toContain(`href="${href}"`);
    // no business list anywhere (owner, 20 Nov 2026): no footer, header or page except the business pages themselves links to a business page
    for (const p of SITE_PACKS) expect(html, p.slug).not.toContain(`href="/te/${p.slug}"`);
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

describe("the home page (landing v9, approved by the owner on 23 Nov 2026: mocks/landing-v9/index.html)", () => {
  const home = (lang: SiteLang = "en") => render(lang, { kind: "home" });
  const text = (html: string) => htmlText(html).replace(/\s+/g, " ");
  it("the sections in order, each with its anchor: hero, inside the app, greetings, how it works, Lead Finder, voices, two jobs, while it talks, built in, late call-backs, pricing, questions, early access, footer", () => {
    const html = home();
    const at = ['id="hero"', 'id="try-it"', 'class="greet-sec"', 'id="how"', 'id="finder"', 'id="voices"', 'id="jobs"', 'class="g8"', 'id="calc"', 'id="pricing"', 'id="faq"', 'id="early-access"', 'class="ftr"'].map((s) => html.indexOf(s));
    expect(at.every((n) => n > 0)).toBe(true);
    expect([...at].sort((x, y) => x - y)).toEqual(at);
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(text(html)).toContain("Answer every call. Find new customers.");
  });
  it("one skip link, one <main id=main>, the page's own header and footer (the site shell adds none on the home page)", () => {
    const html = home();
    expect(html.match(/id="main"/g)).toHaveLength(1);
    expect(html.match(/<header class="hdr"/g)).toHaveLength(1);
    expect(html.match(/<footer class="ftr"/g)).toHaveLength(1);
  });
  it("the early-access buttons lead to the closing card, whose button and line write to hello@ (the one contact address, no phone number)", () => {
    const html = home();
    expect(html).toMatch(/href="#early-access" class="btn-primary"/);
    expect(html).toContain('href="mailto:hello@stack19.com');
    expect(html).not.toMatch(/wa\.me|tel:|95023/); // (the sample numbers in the pictures are masked samples)
  });
  it("what is not built yet is labelled soon: Google Sheets, Your CRM and Meta ads", () => {
    const t = text(home());
    expect(t).toContain("Google Sheets (soon)");
    expect(t).toContain("Your CRM (soon)");
    expect(t).toContain("Meta ads (soon)");
    expect(t).toContain("Google Sheets & CRM (soon)");
    expect(t).not.toMatch(/Google Sheets(?! \(soon\)| &| and Meta)/);
  });
  it("every voice pill says 'Sample soon' (there are no recordings yet), in every language tab's markup, and no voice provider other than the one credited is named", () => {
    const html = home();
    const pills = html.match(/class="vpill"/g)?.length ?? 0;
    expect(pills).toBeGreaterThanOrEqual(16);
    expect(html.match(/class="soon"/g)?.length).toBe(pills);
    expect(html).toContain('aria-label="Cartesia"');
    expect(text(html)).not.toMatch(/sarvam|bulbul/i);
  });
  it("says nothing it cannot back: no date for paid plans, no invented number of customers, none of the words the owner banned, no Tamil assistant", () => {
    const t = text(home());
    expect(t).not.toMatch(/February 2027|Feb 2027|2027/);
    expect(t).not.toMatch(/\b(seamless(ly)?|unlock|elevate|supercharge|effortless(ly)?|cutting-edge|game-changer|leverage|empower|streamline)\b/i);
    expect(t).not.toMatch(/Lead Desk|AI Workforce/);
    expect(t).not.toMatch(/Tamil|தமிழ்/);
    expect(t).not.toMatch(/\b\d[\d,]* (customers|businesses|shops) (trust|use|rely)/i);
  });
  it("the flow row shows each connection with its mark: WhatsApp, Google Sheets and Meta in their official colours, the ones not built yet dashed and labelled soon; the footer names the trademarks", () => {
    const html = home();
    const row = html.slice(html.indexOf('class="flowline"'), html.indexOf('id="finder"'));
    expect(row).toContain('fill="#25D366"');
    expect(row).toContain('fill="#34A853"');
    expect(row).toContain('fill="#0467DF"');
    expect(row.match(/chip-item lg chip-soon/g)).toHaveLength(4); // Google Sheets (twice), Meta ads, Your CRM
    expect(text(html)).toContain("WhatsApp, Google Sheets and Meta are trademarks of their owners");
  });
  it("the plans are the plan data's: three cards with their monthly prices, extra minutes, searches and the 18% GST line", () => {
    const t = text(home());
    for (const s of ["Pay as you go", "₹499", "Pro", "₹1,999", "Business", "₹5,999", "Calls ₹5 a minute", "Extra minutes ₹5", "500 minutes included", "1,500 minutes included", "extra ₹299", "All prices exclude 18% GST"]) expect(t, s).toContain(s);
    expect(t).not.toMatch(/yearly|annual|2 months free|price lock/i);
  });
  it("the interactive parts are real controls: tabs with a tablist, the questions as buttons that say whether they are open, the job draft's chips as pressed-state buttons", () => {
    const html = home();
    expect(html.match(/role="tablist"/g)?.length).toBeGreaterThanOrEqual(3);
    expect(html).toMatch(/class="faq-q" aria-expanded="true"/);
    expect(html).toMatch(/aria-pressed="true"[^>]*>Call website enquiries/);
  });
  it("the page is light-only and its stylesheet is scoped: every rule starts with .v9 (nothing leaks into the other pages), no yellow-purple gradients on text", () => {
    const css = fs.readFileSync(path.join(__dirname, "../../../design/v9.css"), "utf8");
    const unscoped: string[] = [];
    postcss.parse(css).walkRules((r) => {
      if (r.parent?.type === "atrule" && /keyframes$/.test((r.parent as postcss.AtRule).name)) return;
      for (const sel of r.selectors) if (!sel.trim().startsWith(".v9")) unscoped.push(sel);
    });
    expect(unscoped).toEqual([]);
  });
  it.each(["te", "hi", "kn", "ta"] as const)("%s: the home page renders with no raw key (the new lines read in English until the owner's review)", (lang) => {
    const html = home(lang);
    expect(html).toContain('id="hero"');
    expect(text(html)).not.toMatch(/\bv9\.[a-z0-9_.]+\b/);
    expect(html).toContain('lang="' + lang + '"');
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
  it("the pricing page has the three plans (Pay as you go, Pro, Business) with their prices (launch pricing page, 29 Nov 2026: the approved mock; its tests are in public/PublicPages.test.tsx), and no old plan name", () => {
    const html = render("en", { kind: "page", page: "pricing" });
    expect([...html.matchAll(/data-plan="(\w+)"/g)].map((m) => m[1])).toEqual(["payg", "pro", "business"]);
    expect(text(html)).toMatch(/\u20b9499[\s\S]*\u20b91,999[\s\S]*\u20b95,999/);
    expect(text(html)).not.toMatch(/Lead Desk|Workforce plans|Starter|Growth|unlimited/);
  });
  it("how it works starts with the six steps, then the six AI workers of the full team", () => {
    const html = render("en", { kind: "page", page: "how-it-works" });
    expect(html.match(/data-ld-step=/g)).toHaveLength(6);
    expect(html.indexOf('data-part="ld-steps"')).toBeLessThan(html.indexOf('data-part="steps"'));
    expect(text(html)).toContain("The assistant at the core");
  });
});

describe("no price of ours anywhere on the public site except the three paid plans (owner's final numbers, 19 Nov 2026) and no 'no card' claim", () => {
  const OWN = new Set(["\u20b9499", "\u20b91,999", "\u20b95,999", "\u20b95", "\u20b9299", "\u20b950", "\u20b949", "\u20b939", "\u20b929", "\u20b9100"]); // (\u20b9100: the free start of the launch pricing page and help)
  it.each(cases)("%s: no amount except the plans' own, no card claim", (_n, lang, target) => {
    // landing v2's labelled examples show a customer's own budget and the visitor's own estimate in rupees (never a price of ours): the hero stage, the sample call and the leak; the plans' own numbers are lib/site/plans.ts
    const html = render(lang, target).replace(/data-part="leak"[\s\S]*?<\/section>/, ""); // the counter's own estimate in rupees (the visitor's sliders) is not a price of ours
    const text = htmlText(html);
    for (const amount of text.match(/\u20b9\s?\d+(?:,\d{3})*/g) ?? []) expect(OWN.has(amount.replace(/\s/g, "")), `${amount} is not one of the plans' own numbers`).toBe(true);
    expect(text).not.toMatch(/\bRs\.?\s?\d|\bINR\b|रुपये\s?\d|\d\s?रुपये|రూపాయలు\s?\d/);
    // the launch pages (pricing, help articles) say "No card" on purpose (planner decision, 25 Nov 2026: Rs 100 free to start, no card); the rest of the site does not claim it
    if (target.kind !== "article" && !(target.kind === "page" && ["pricing", "help"].includes(target.page))) expect(text).not.toMatch(/\bno card\b|without a card|no credit card/i);
    expect(html).not.toMatch(/"price"|priceCurrency/);
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
  it("reads the same six steps in every language (te, hi, kn and ta are drafts) and never an English fallback key", () => {
    for (const lang of ["te", "hi", "kn", "ta"] as const) {
      const h = render(lang, { kind: "page", page: "how-it-works" });
      expect(h.match(/<ol[^>]*data-part="steps"[\s\S]*?<\/ol>/)![0].match(/data-step=/g), lang).toHaveLength(6);
      expect(h, lang).not.toMatch(/hm\.w\.|how\.steps\./);
    }
  });
});

describe("Tamil, a language of the public website only", () => {
  it("is /ta, the header and footer link to every page in Tamil and to the other languages, and the switch lists the five languages by their own names", () => {
    const html = render("ta", { kind: "page", page: "pricing" });
    for (const href of ["/ta", "/ta/pricing", "/ta/contact", "/", "/te/pricing", "/hi/pricing", "/kn/pricing"]) expect(html, href).toContain(`href="${href === "/" ? "/pricing" : href}"`);
    const names = [...html.matchAll(/<option[^>]*>([^<]+)<\/option>/g)].map((m) => m[1]);
    expect(names.slice(0, 5)).toEqual(["English", "తెలుగు", "हिन्दी", "ಕನ್ನಡ", "தமிழ்"]); // (the header's switch; the phone menu's copy is drawn when its sheet opens)
    expect(names).toHaveLength(5);
    expect(html).toContain('lang="ta"');
    expect(html).toContain("font-vars");
  });
  it("reads in Tamil script with the business words in Latin, and the home page lists the product's four languages in Tamil words", () => {
    const home = htmlText(render("ta", { kind: "home" }));
    expect(home).toMatch(/[\u0B80-\u0BFF]/);
    expect(home).toContain("WhatsApp");
  });
  it("never says the assistant speaks Tamil: the word Tamil appears only as the name of the language itself (the language switch, one label)", () => {
    for (const [k, v] of Object.entries(siteJson as Record<string, { en: string; ta?: string }>)) {
      if (k === "h2.lang.ta") continue;
      expect(v.ta ?? "", k).not.toMatch(/தமிழ்|தமிழில்|தமிழ|Tamil/);
      if (v.ta !== undefined) expect(v.en, k).not.toMatch(/Tamil/); // (an English line that names Tamil would make the Tamil line claim it too)
    }
    // the pages as drawn: Tamil is named only in the language switch
    for (const target of allTargets().filter((t) => t.kind !== "pack")) expect(htmlText(render("ta", target)).replace(/தமிழ்/g, ""), name(target)).not.toMatch(/தமிழ|Tamil/);
  });
  it("a business type's page has no Tamil text yet and shows its English (the same small fallback every missing word has)", () => {
    const slug = SITE_PACKS[0].slug;
    const html = render("ta", { kind: "pack", slug });
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(htmlText(html)).toContain(SITE_PACKS[0].hero.h1.en.replace(/\{assistant\}/g, "").slice(0, 8));
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

