import { cleanup, render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const jarValues: Record<string, string> = {};
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => (name in jarValues ? { name, value: jarValues[name] } : undefined) }) }));
vi.mock("@/design/fonts", () => ({ v2FontClassName: () => "font-vars" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/privacy" }));
const draft = vi.hoisted(() => ({ on: false }));
vi.mock("@/lib/legal/version", async (orig) => {
  const real = await orig<typeof import("@/lib/legal/version")>();
  return { ...real, get LEGAL_IS_DRAFT() { return draft.on; } };
});

import { LegalFrame } from "@/components/v2/legal/LegalFrame";
import { BRAND_TEXT } from "@/design/brand";
import PrivacyPage, { metadata as privacyMeta } from "@/app/(legal)/privacy/page";
import TermsPage, { metadata as termsMeta } from "@/app/(legal)/terms/page";
import DataDeletionPage, { metadata as deletionMeta } from "@/app/(legal)/data-deletion/page";
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
    ["privacy", PrivacyPage, "Privacy Policy"],
    ["terms", TermsPage, "Terms of Use"],
    ["data-deletion", DataDeletionPage, "Delete your data"],
  ] as const)("%s: one h1, the version and the last-updated day, and no 'draft' or 'pending review' line on the page (owner decision, job DB)", async (_n, Page, title) => {
    render(await Page());
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: title })).toHaveAttribute("lang", "en");
    expect(screen.queryByRole("note")).toBeNull();
    expect(document.body.textContent).toContain(`Version ${LEGAL_VERSION}`);
    expect(LEGAL_UPDATED).toBe("2026-10-25");
    expect(document.body.textContent).toContain("Last updated: 25 October 2026");
    expect(document.body.textContent).not.toMatch(/pending legal review|\[EFFECTIVE DATE\]|\[CONFIRM|\[LEGAL REVIEW/);
  });
  it("the draft banner comes back, in English, when the flag is switched on again, and nothing else changes", async () => {
    draft.on = true;
    render(await PrivacyPage());
    expect(screen.getByRole("note")).toHaveTextContent("Draft, pending legal review.");
    expect(screen.getByRole("note")).toHaveAttribute("lang", "en");
    expect(screen.getByRole("heading", { level: 1, name: "Privacy Policy" })).toBeInTheDocument();
  });
  it("no text has a missing fact: nothing is drawn highlighted, and every owner fact comes from lib/site/business.ts", async () => {
    render(await PrivacyPage());
    expect(document.querySelectorAll("mark[data-placeholder]")).toHaveLength(0);
    for (const doc of [PRIVACY, TERMS]) for (const m of textOf(doc).matchAll(/\[[A-Z][^\]]*\]/g)) expect(m[0].match(PLACEHOLDER)?.[0], m[0]).toBe(m[0]); // the highlighter still matches any that is ever added
    expect(document.body.textContent).toContain("privacy@stack19.com");
    expect(document.body.textContent).toContain("Gowtham Reddy Sodanapalli");
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
  it("the Privacy Policy covers what DPDP asks for: roles, purposes, consent and its withdrawal, access, correction, erasure, nomination, grievance, retention, transfers, children", () => {
    const all = textOf(PRIVACY);
    for (const word of ["data fiduciary", "data processor", "Why we use it", "consent", "withdraw", "access", "correction", "erasure", "nominat", "grievance", "How long we keep it", "transfers abroad", "Children", "Data Protection Board", "GDPR", "Grievance Officer", "{proprietor}", "{privacy_email}"]) expect(all.toLowerCase(), word).toContain(word.toLowerCase());
  });
  it("it names what we really keep and who handles it: every group of the data inventory, the processors, voice, the AI, cookies, backups, the do-not-contact keys", () => {
    const all = textOf(PRIVACY);
    for (const word of ["phone number", "e-mail", "job title", "enquiries", "store visits", "call requests", "AI assistant", "Supabase", "Google Cloud", "WhatsApp", "speech", "Meta", "recording", "backup", "do-not-contact", "sb-<project>-auth-token", "sme_lang", "sme_theme", "sme_consent", "Settings, Privacy", "24-hour"]) expect(all, word).toContain(word);
  });
  it("it says the assistant is an AI and that messages to customers may be written by AI and are labelled, in both texts", () => {
    for (const doc of [PRIVACY, TERMS]) {
      const all = textOf(doc);
      expect(all).toMatch(/(Our assistant is an AI|The assistant in \{brand\} is an AI|The assistant is an AI)/);
      expect(all).toMatch(/written by AI[^"]*labelled/);
    }
  });
  it("it makes no promise the product does not keep: no 'compliant', no 'we never', no 'guarantee' of security", () => {
    const all = textOf(PRIVACY);
    expect(all).not.toMatch(/\bcompliant\b|\bcertified\b|military|bank-grade|100%|never be (hacked|breached)/i);
    expect(all).toContain("No service can promise perfect security");
  });
  it("the terms say the AI does not set prices, a person is responsible and the Owner approves a campaign", () => {
    const all = textOf(TERMS);
    expect(all).toContain("does not set or change prices");
    expect(all).toContain("until you, the Owner, have approved it");
  });
  it("the pages are public, have a stable address as their canonical link and the share picture, and are not for search engines until launch", () => {
    for (const [m, path, title] of [[privacyMeta, "/privacy", "Privacy Policy"], [termsMeta, "/terms", "Terms of Use"], [deletionMeta, "/data-deletion", "Delete your data"]] as const) {
      expect(m.robots).toEqual({ index: false, follow: false });
      expect(m.title).toBe(`${title} · ${BRAND_TEXT}`);
      expect(m.alternates?.canonical).toBe(path);
      expect(m.openGraph).toMatchObject({ url: path, siteName: BRAND_TEXT, images: [expect.objectContaining({ width: 1200, height: 630 })] });
    }
  });
});

describe("in the visitor's language (job DB)", () => {
  it.each(["te", "hi", "kn"] as const)("%s: the Privacy Policy is the whole text in that language, marked as a machine-written draft; the summary and the footer words are in that language too", async (lang) => {
    jarValues.sme_lang = lang;
    render(await PrivacyPage());
    const d = legalDict(lang);
    const box = screen.getByRole("heading", { name: d["legal.summary.title"] }).closest("section")!;
    expect(box).toHaveAttribute("lang", lang);
    for (const n of [1, 2, 3, 4, 5, 6] as const) expect(box.textContent).toContain(d[`legal.sum.privacy.${n}` as "legal.sum.privacy.1"]);
    expect(box.textContent).not.toContain(d["legal.summary.note"]); // the full text is translated, so the note is the other one
    const note = document.querySelector('[data-legal="translated"]')!;
    expect(note).toHaveTextContent(d["legal.translated.note"]);
    expect(note).toHaveAttribute("lang", lang);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveAttribute("lang", lang);
    expect(h1.textContent).not.toBe("Privacy Policy");
    expect(document.getElementById("collect")!.closest("div")).toHaveAttribute("lang", lang);
    expect(document.body.textContent).toContain("privacy@stack19.com");
    expect(document.body.textContent).not.toMatch(/\{[a-z_]+\}/);
    expect(document.body.textContent).toContain(d["legal.updated"].replace("{date}", ""));
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
    for (const n of [1, 2, 3, 4] as const) expect(box.textContent).toContain(d[`legal.sum.terms.${n}` as "legal.sum.terms.1"]);
    expect(box.textContent).toContain(d["legal.summary.note"]);
    expect(document.querySelector('[data-legal="translated"]')).toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Terms of Use");
    expect(document.getElementById("service")!.closest("div")).toHaveAttribute("lang", "en");
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
    expect(within(nav).getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");
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
    expect(out).toContain("only the cookies this site needs to work");
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
    expect(await html()).toContain(legalT("kn")("cookie.notice.ok"));
  });
  it("loads no outside script and no analytics tag", async () => {
    const out = await html();
    expect(out).not.toMatch(/<script[^>]*src=["']https?:/);
    expect(out).not.toMatch(/gtag|googletagmanager|analytics/i);
  });
});
