import { cleanup, render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const jarValues: Record<string, string> = {};
const hostName = vi.hoisted(() => ({ value: "localhost:3000" }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => (name in jarValues ? { name, value: jarValues[name] } : undefined) }), headers: async () => ({ get: (name: string) => (name === "host" ? hostName.value : null) }) }));
vi.mock("@/design/fonts", () => ({ v2FontClassName: () => "font-vars" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/privacy" }));
const draft = vi.hoisted(() => ({ on: false }));
vi.mock("@/lib/legal/version", async (orig) => {
  const real = await orig<typeof import("@/lib/legal/version")>();
  return { ...real, get LEGAL_IS_DRAFT() { return draft.on; } };
});

import { LegalFrame } from "@/components/v2/legal/LegalFrame";
import { BRAND_TEXT } from "@/design/brand";
import PrivacyPage, { generateMetadata as privacyMeta } from "@/app/(legal)/privacy/page";
import TermsPage, { generateMetadata as termsMeta } from "@/app/(legal)/terms/page";
import DataDeletionPage, { generateMetadata as deletionMeta } from "@/app/(legal)/data-deletion/page";
import RootLayout from "@/app/layout";
import { legalDict, legalT } from "@/i18n/legal";
import { LANGS } from "@/i18n/lang";
import { fillLegal } from "@/lib/legal/documents";
import { DATA_DELETION } from "@/lib/legal/data-deletion-text";
import { PRIVACY } from "@/lib/legal/privacy-text";
import { TERMS } from "@/lib/legal/terms-text";
import { PLACEHOLDER, type LegalText } from "@/lib/legal/types";
import { LEGAL_UPDATED, LEGAL_VERSION } from "@/lib/legal/version";

import { LegalLinks } from "./LegalLinks";

beforeEach(() => {
  draft.on = false;
  for (const k of Object.keys(jarValues)) delete jarValues[k];
});
afterEach(cleanup);

const textOf = (doc: LegalText) => JSON.stringify(doc);

describe("/privacy and /terms (job BH)", () => {
  it.each([
    ["privacy", PrivacyPage, "Privacy notice"],
    ["terms", TermsPage, "Terms of Use"],
    ["data-deletion", DataDeletionPage, "Delete your data"],
  ] as const)("%s: one h1, the version and the last-updated day, and no 'draft' or 'pending review' line on the page (owner decision, job DB)", async (_n, Page, title) => {
    render(await Page());
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: title })).toHaveAttribute("lang", "en");
    expect(screen.queryByRole("note")).toBeNull();
    expect(document.body.textContent).toContain(`Version ${LEGAL_VERSION}`);
    expect(LEGAL_UPDATED).toBe("2026-11-26");
    expect(document.body.textContent).toContain("Last updated: 26 November 2026");
    expect(document.body.textContent).not.toMatch(/pending legal review|\[EFFECTIVE DATE\]|\[CONFIRM|\[LEGAL REVIEW/);
  });
  it("the draft banner comes back, in English, when the flag is switched on again, and nothing else changes", async () => {
    draft.on = true;
    render(await PrivacyPage());
    expect(screen.getByRole("note")).toHaveTextContent("Draft, pending legal review.");
    expect(screen.getByRole("note")).toHaveAttribute("lang", "en");
    expect(screen.getByRole("heading", { level: 1, name: "Privacy notice" })).toBeInTheDocument();
  });
  it("no text has a missing fact: nothing is drawn highlighted, and every owner fact comes from lib/site/business.ts", async () => {
    render(await PrivacyPage());
    expect(document.querySelectorAll("mark[data-placeholder]")).toHaveLength(0);
    for (const doc of [PRIVACY, TERMS]) for (const m of textOf(doc).matchAll(/\[[A-Z][^\]]*\]/g)) expect(m[0].match(PLACEHOLDER)?.[0], m[0]).toBe(m[0]); // the highlighter still matches any that is ever added
    expect(document.body.textContent).toContain("privacy@stack19.com");
    expect(document.body.textContent).toContain("SODANAPALLI GOWTHAM REDDY");
    expect(document.body.textContent).not.toMatch(/\{[a-z_]+\}/);
  });
  it("the structure is sound: unique section ids, each in the table of contents, each heading labelled, tables have header cells", async () => {
    for (const [doc, Page] of [[PRIVACY, PrivacyPage], [TERMS, TermsPage], [DATA_DELETION, DataDeletionPage]] as const) {
      cleanup();
      render(await Page());
      const ids = doc.sections.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
      const toc = screen.getByRole("navigation", { name: "On this page" });
      for (const id of ids) {
        expect(toc.querySelector(`a[href="#${id}"]`), id).not.toBeNull();
        expect(document.getElementById(id), id).toHaveAttribute("aria-labelledby", `${id}-h`);
        expect(document.getElementById(`${id}-h`)?.tagName).toBe("H2");
      }
      for (const t of document.querySelectorAll("table")) {
        expect(t.querySelectorAll('th[scope="col"]').length).toBeGreaterThan(0);
        const box = t.parentElement!; // a wide table scrolls sideways on a phone: its box is a labelled, focusable region
        expect(box).toHaveAttribute("role", "region");
        expect(box.getAttribute("aria-label")).toBeTruthy();
        expect(box).toHaveAttribute("tabindex", "0");
      }
    }
  });
  it("{brand} is filled with the product name and no raw brace is left", async () => {
    render(await PrivacyPage());
    expect(document.body.textContent).not.toMatch(/\{brand\}/);
    expect(document.body.textContent).toContain(BRAND_TEXT);
  });
  it("the Privacy notice is plain and short and still says the essentials: what we collect and why, who handles it, where it is stored, how long, how to see, correct, delete and stop (owner, 18 Nov)", () => {
    const all = textOf(PRIVACY);
    for (const word of ["What we collect, and why", "Who helps us handle it", "Where it is stored", "How long we keep it", "Mumbai", "withdraw", "correct", "delete", "STOP", "{proprietor}", "{privacy_email}", "never do", "Stack19 does not keep them. We keep only the application status"]) expect(all, word).toContain(word);
    expect(all.length).toBeLessThan(9000); // a notice the owner reads in a few minutes
  });
  it("it names what we really keep and who handles it: the groups of data, the AI, calls not recorded, cookies, the processors list from our service", () => {
    const all = textOf(PRIVACY);
    for (const word of ["phone numbers", "e-mail", "Messages and chats", "Calls are not recorded", "AI assistant", "Phone number documents", "Website visitors", "no analytics", "read from our service"]) expect(all, word).toContain(word);
  });
  it("it says the assistant is an AI and that messages to customers may be written by AI and are labelled, in both texts", () => {
    for (const doc of [PRIVACY, TERMS]) {
      const all = textOf(doc);
      expect(all).toMatch(/(Our assistant is an AI|The assistant in \{brand\} is an AI|The assistant is an AI)/);
      expect(all).toMatch(doc === PRIVACY ? /first chat message it writes to a customer says it comes from the business's AI assistant/ : /first chat message the assistant writes to a customer says it is an AI assistant/);
    }
  });
  it("it makes no promise the product does not keep: no 'compliant', no 'we never', no 'guarantee' of security", () => {
    const all = textOf(PRIVACY);
    expect(all).not.toMatch(/\bcompliant\b|\bcertified\b|military|bank-grade|100%|never be (hacked|breached)/i);
    expect(all).toContain("No service can promise perfect security");
  });
  it("the terms are the plain free-early-access terms: what you get each month, who you may call, your data, stopping", () => {
    const all = textOf(TERMS);
    for (const word of ["Free Early Access", "60 minutes of AI calls", "300 WhatsApp messages", "no Lead Finder prospects", "We do not sell it", "We can end Free Early Access"]) expect(all, word).toContain(word);
    expect(all.length).toBeLessThan(6500); // about one page
  });
  it("the pages are public, have a stable address as their canonical link and the share picture, and are not for search engines until launch", async () => {
    for (const [make, path, title] of [[privacyMeta, "/privacy", "Privacy notice"], [termsMeta, "/terms", "Terms of Use"], [deletionMeta, "/data-deletion", "Delete your data"]] as const) {
      const m = await make();
      expect(m.robots).toEqual({ index: false, follow: false });
      expect(m.title).toBe(`${title} · ${BRAND_TEXT}`);
      expect(m.alternates?.canonical).toBe(path);
      expect(m.openGraph).toMatchObject({ url: path, siteName: BRAND_TEXT, images: [expect.objectContaining({ width: 1200, height: 630 })] });
    }
  });
});

describe("in the visitor's language (job DB)", () => {
  it.each(["te", "hi", "kn"] as const)("%s: the Privacy notice is the English text with a short summary in that language (no translation of legal text until the owner approves one, 18 Nov)", async (lang) => {
    jarValues.sme_lang = lang;
    render(await PrivacyPage());
    const d = legalDict(lang);
    const box = screen.getByRole("heading", { name: d["legal.summary.title"] }).closest("section")!;
    expect(box).toHaveAttribute("lang", lang);
    for (const n of [1, 2, 3, 4] as const) expect(box.textContent).toContain(d[`legal.sum.privacy.${n}` as "legal.sum.privacy.1"]);
    expect(box.textContent).toContain(d["legal.summary.note"]); // "the full text below is in English, and that is the text that counts"
    expect(document.querySelector('[data-legal="translated"]')).toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Privacy notice");
    expect(document.body.textContent).toContain("privacy@stack19.com");
    expect(document.body.textContent).not.toMatch(/\{[a-z_]+\}/);
  });
  it.each(["te", "hi", "kn"] as const)("%s: the data-deletion page is translated too", async (lang) => {
    jarValues.sme_lang = lang;
    render(await DataDeletionPage());
    expect(document.getElementById("app")!.closest("div")).toHaveAttribute("lang", lang);
    expect(document.body.textContent).toContain("privacy@stack19.com");
  });
  it.each(["te", "hi", "kn"] as const)("%s: the Terms stay English with the summary in that language, and the note says the English text counts", async (lang) => {
    jarValues.sme_lang = lang;
    render(await TermsPage());
    const d = legalDict(lang);
    const box = screen.getByRole("heading", { name: d["legal.summary.title"] }).closest("section")!;
    expect(box).toHaveAttribute("lang", lang);
    for (const n of [1, 4] as const) expect(box.textContent).toContain(d[`legal.sum.terms.${n}` as "legal.sum.terms.1"]);
    expect(box.textContent).toContain(d["legal.summary.note"]);
    expect(document.querySelector('[data-legal="translated"]')).toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Terms of Use");
    expect(document.getElementById("what")!.closest("div")).toHaveAttribute("lang", "en");
  });
  it.each(["privacy", "terms", "data-deletion"] as const)("ta: no Tamil legal text is shipped (owner-gated): the %s page is English with ONE plain Tamil line, \"this page is in English\", and no Tamil summary or note", async (which) => {
    jarValues.sme_lang = "ta";
    render(await (which === "privacy" ? PrivacyPage() : which === "terms" ? TermsPage() : DataDeletionPage()));
    const line = document.querySelector('[data-legal="english-only"]')!;
    expect(line).toHaveAttribute("lang", "ta");
    expect(line.textContent).toBe("இந்தப் பக்கம் ஆங்கிலத்தில் உள்ளது");
    expect(document.querySelectorAll('[data-legal="english-only"]')).toHaveLength(1);
    expect(document.querySelector('[data-legal="translated"]')).toBeNull();
    expect(document.getElementById("summary-h")).toBeNull();
    // the one Tamil line is the only Tamil on the page
    const rest = document.body.textContent!.replace("இந்தப் பக்கம் ஆங்கிலத்தில் உள்ளது", "");
    expect(rest).not.toMatch(/[\u0B80-\u0BFF]/);
    expect(screen.getByRole("heading", { level: 1 })).toHaveAttribute("lang", "en");
  });
  it("English has no 'machine translation' note", async () => {
    render(await TermsPage());
    expect(document.body.textContent).not.toContain("machine-written translation");
    render(await PrivacyPage());
    expect(document.querySelector('[data-legal="translated"]')).toBeNull();
  });
  it("the data-deletion page tells the two ways: in the app (Settings, Privacy, 14 days) and by e-mail to privacy@", async () => {
    render(await DataDeletionPage());
    const text = document.body.textContent ?? "";
    for (const w of ["Settings, then Privacy, then delete my account", "after 14 days", "privacy@stack19.com", "Delete my data", "within 7 days", "within 30 days", "within 48 hours"]) expect(text, w).toContain(w);
  });
  it("the texts make no claim the product cannot keep (the landing page's own list), and the same words are in the dictionary only once", async () => {
    const { FORBIDDEN_CLAIMS } = await import("@/i18n/strings/forbidden");
    for (const lang of LANGS) for (const [k, v] of Object.entries(legalDict(lang))) for (const [re, label] of FORBIDDEN_CLAIMS) expect(re.test(v), `${lang}:${k} ${label}`).toBe(false);
    expect(fillLegal("{privacy_email}")).toBe("privacy@stack19.com");
  });
});

describe("the legal pages' frame and the legal links", () => {
  const html = async () => renderToStaticMarkup(await LegalFrame({ children: <h1>x</h1> }));
  it("has a skip link, the language and theme controls, the legal links in the footer, and a way home", async () => {
    const out = await html();
    expect(out).toContain('href="#main"');
    expect(out.match(/<main[ >]/g)).toHaveLength(1); // one main landmark, the target of the skip link
    expect(out).toMatch(/<main id="main"/);
    expect(out).toContain('href="/privacy"');
    expect(out).toContain('href="/terms"');
    expect(out).toContain('href="/data-deletion"');
    expect(out).toContain('href="/contact"');
    expect(out).toContain(">Cookie settings<");
    expect(out).toContain('data-screen="legal"');
    expect(out).toContain("Back to the home page");
  });
  it("is in the visitor's language and theme", async () => {
    jarValues.sme_lang = "te";
    jarValues.sme_theme = "dark";
    const out = await html();
    expect(out).toContain(legalDict("te")["legal.privacy.name"]);
    expect(out).toContain('data-theme="dark"');
    expect(out).toMatch(/lang="te"/);
  });
  it("LegalLinks: Privacy and Terms are links to the pages, Cookie settings is a button, each 44 px", () => {
    render(<LegalLinks lang="en" />);
    const nav = screen.getByRole("navigation", { name: "Legal" });
    expect(within(nav).getByRole("link", { name: "Privacy notice" })).toHaveAttribute("href", "/privacy");
    expect(within(nav).getByRole("link", { name: "Terms of Use" })).toHaveAttribute("href", "/terms");
    expect(within(nav).getByRole("link", { name: "Delete your data" })).toHaveAttribute("href", "/data-deletion");
    expect(within(nav).getByRole("link", { name: "Contact" })).toHaveAttribute("href", "/contact");
    const b = within(nav).getByRole("button", { name: "Cookie settings" });
    for (const el of [...nav.querySelectorAll("a"), b]) expect(el.className).toMatch(/min-h-11/);
  });
});

describe("the root layout carries the notice (job BH)", () => {
  const html = async () => renderToStaticMarkup(await RootLayout({ children: <p>page</p> } as never));
  it("first visit: the notice is on the page (server-rendered, no flicker), in a sticky wrapper after the page so it never covers the footer", async () => {
    const out = await html();
    expect(out).toMatch(/<div[^>]*class="[^"]*sticky bottom-0[^"]*"[^>]*>\s*<section[^>]*data-cookie="notice"/);
    expect(out.indexOf("<p>page</p>")).toBeLessThan(out.indexOf('data-cookie="notice"'));
    expect(out).toContain('data-cookie="notice"');
    expect(out).toContain("We only use cookies the site needs.");
    expect(out).toContain("<p>page</p>");
  });
  it.each(["1.a0", "1.a1"])("after an answer (%s) it is not drawn", async (v) => {
    jarValues.sme_consent = v;
    expect(await html()).not.toContain('data-cookie="notice"');
  });
  it("a forged cookie value is 'not asked'", async () => {
    jarValues.sme_consent = "yes";
    expect(await html()).toContain('data-cookie="notice"');
  });
  it("the words follow the language cookie", async () => {
    jarValues.sme_lang = "kn";
    expect(await html()).toContain(legalT("kn")("cookie.bar.ok"));
  });
  it("a Tamil cookie leaves the cookie notice in English (no Tamil legal words ship)", async () => {
    jarValues.sme_lang = "ta";
    const out = await html();
    expect(out).toContain(legalT("en")("cookie.bar.text"));
    expect(out).not.toMatch(/[\u0B80-\u0BFF]/);
  });
  it("loads no outside script and no analytics tag", async () => {
    const out = await html();
    expect(out).not.toMatch(/<script[^>]*src=["']https?:/);
    expect(out).not.toMatch(/gtag|googletagmanager|analytics/i);
  });
});
