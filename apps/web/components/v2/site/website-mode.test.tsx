import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/design/fonts", () => ({ v2FontClassName: () => "font-vars" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/" }));
vi.mock("./LazyIslands", async () => ({ PaverCalculator: (await import("./PaverCalculator")).PaverCalculator, ContactForm: (await import("./ContactForm")).ContactForm, WaitlistForm: (await import("./WaitlistForm")).WaitlistForm }));

import { renderToStaticMarkup } from "react-dom/server";

import { LANGS, type Lang } from "@/i18n/lang";
import { siteDict } from "@/i18n/site";
import { isServed } from "@/lib/site/mode";
import { SITE_PACKS } from "@/lib/site/packs";
import { sitePath, type SiteTarget } from "@/lib/site/paths";
import { allTargets } from "@/lib/site/routes";

import { OpeningSoon } from "./OpeningSoon";
import { SitePage, type SiteActions } from "./SitePage";

const actions: SiteActions = { contactChat: vi.fn(), quoteChat: vi.fn(), chatAvailable: true, waitlist: vi.fn() };
const render = (lang: Lang, target: SiteTarget, a: SiteActions = actions) => renderToStaticMarkup(<SitePage lang={lang} target={target} actions={a} />);
const name = (t: SiteTarget) => (t.kind === "home" ? "home" : t.kind === "page" ? t.page : t.slug);
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
const text = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ");

beforeEach(() => vi.stubEnv("SITE_MODE", "website"));
afterEach(() => vi.unstubAllEnvs());

const served = allTargets().filter((t) => isServed(t, "website"));
const cases = served.flatMap((t) => LANGS.map((l) => [`${name(t)} ${l}`, l, t] as const));

describe("website mode: the public pages (job DQ)", () => {
  it("serves exactly the home page, the three business pages, plans and contact", () => {
    expect(served.map(name)).toEqual(["home", "pricing", "contact", ...SITE_PACKS.map((p) => p.slug)]);
  });

  it.each(cases)("%s: no link to sign in, sign up or the app; 'Book a demo' instead; no 'Start trial'; nothing unfilled", (_n, lang, target) => {
    const html = render(lang, target);
    const links = hrefs(html);
    for (const bad of ["/signup", "/login", "/app", "/setup"]) expect(links.filter((h) => h === bad || h.startsWith(`${bad}/`) || h.startsWith(`${bad}?`)), `${name(target)}: ${bad}`).toEqual([]);
    const d = siteDict(lang);
    expect(text(html)).toContain(d["demo.cta"]);
    expect(text(html)).not.toContain(d["nav.signin"]);
    expect(text(html)).not.toContain(d["nav.start"]);
    expect(text(html)).not.toMatch(/\{[a-z_]+\}/);
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
  });

  it.each(cases.filter(([, , t]) => t.kind !== "page" || t.page === "contact"))("%s: the demo form is on the page (#demo) and the 'Book a demo' buttons point to it", (_n, lang, target) => {
    const html = render(lang, target);
    expect(html).toContain('id="demo"');
    expect(html).toContain('data-part="waitlist"');
    expect(hrefs(html)).toContain("#demo");
    expect(text(html)).toContain(siteDict(lang)["demo.title"]);
  });

  it("the plans page has no form of its own: its buttons go to the contact page's", () => {
    const html = render("te", { kind: "page", page: "pricing" });
    expect(html).not.toContain('id="demo"');
    expect(hrefs(html)).toContain("/te/contact#demo");
  });

  it("the footer lists only the pages that are served; the pages that are not are not linked from anywhere", () => {
    for (const lang of LANGS) {
      const all = cases.filter(([, l]) => l === lang).flatMap(([, , t]) => hrefs(render(lang, t)));
      for (const page of ["how-it-works", "security", "help"] as const) expect(all.filter((h) => h.endsWith(`/${page}`)), `${lang} ${page}`).toEqual([]);
      expect(all).toContain(sitePath(lang, { kind: "page", page: "pricing" }));
      expect(all).toContain(sitePath(lang, { kind: "page", page: "contact" }));
    }
  });

  it("the trial note gives way to 'opening soon'", () => {
    const html = render("en", { kind: "home" });
    expect(text(html)).toContain(siteDict("en")["demo.note"]);
    expect(html).not.toContain('data-part="trial-note">' + siteDict("en")["hero.note"].slice(0, 20));
  });

  it("making no claim we cannot prove: no 'stored in India', no 'includes GST', no 'most popular', no customer logos or praise", () => {
    for (const lang of LANGS)
      for (const [, , t] of cases.filter(([, l]) => l === lang)) {
        const body = text(render(lang, t));
        expect(body, `${lang} ${name(t)}`).not.toMatch(/stored in India|Data stored|include[sd]? GST|incl\.? GST|most popular|testimonial|trusted by|used by|customers love/i);
      }
  });

  it("without the setting the sign-in and sign-up buttons are back", () => {
    vi.unstubAllEnvs();
    const html = render("en", { kind: "home" }, { ...actions, waitlist: undefined });
    expect(hrefs(html)).toEqual(expect.arrayContaining(["/signup", "/login"]));
    expect(html).not.toContain('id="demo"');
    expect(text(html)).not.toContain(siteDict("en")["demo.cta"]);
  });

  it("the form is not drawn when the waitlist is switched off, and the buttons then lead to the contact page", () => {
    vi.stubEnv("WAITLIST", "off");
    const html = render("en", { kind: "home" });
    expect(html).not.toContain('id="demo"');
    expect(hrefs(html)).not.toContain("#demo");
  });
});

describe("Opening soon — book a demo", () => {
  it.each(LANGS)("%s: one headline, one line, the form, no way into the app", (lang) => {
    const html = renderToStaticMarkup(<OpeningSoon lang={lang} waitlist={vi.fn()} />);
    const d = siteDict(lang);
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(text(html)).toContain(d["soon.title"]);
    expect(text(html)).toContain(d["soon.sub"]);
    expect(html).toContain('data-part="waitlist"');
    for (const bad of ["/signup", "/login", "/app"]) expect(hrefs(html).filter((h) => h === bad || h.startsWith(`${bad}/`))).toEqual([]);
  });
  it("the English headline is the one the owner asked for", () => {
    expect(siteDict("en")["soon.title"]).toBe("Opening soon — book a demo");
  });
});
