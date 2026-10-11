import { cleanup, render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const jarValues: Record<string, string> = {};
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => (name in jarValues ? { name, value: jarValues[name] } : undefined) }) }));
vi.mock("@/design/fonts", () => ({ v2FontClassName: () => "font-vars" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const draft = vi.hoisted(() => ({ on: true }));
vi.mock("@/lib/legal/version", async (orig) => {
  const real = await orig<typeof import("@/lib/legal/version")>();
  return { ...real, get LEGAL_IS_DRAFT() { return draft.on; } };
});

import { LegalFrame } from "@/components/v2/legal/LegalFrame";
import { BRAND_TEXT } from "@/design/brand";
import PrivacyPage, { metadata as privacyMeta } from "@/app/(legal)/privacy/page";
import TermsPage, { metadata as termsMeta } from "@/app/(legal)/terms/page";
import RootLayout from "@/app/layout";
import { legalDict, legalT } from "@/i18n/legal";
import { LANGS } from "@/i18n/lang";
import { PRIVACY } from "@/lib/legal/privacy-text";
import { TERMS } from "@/lib/legal/terms-text";
import { OWNER_PLACEHOLDERS, PLACEHOLDER, type LegalText } from "@/lib/legal/types";
import { LEGAL_VERSION } from "@/lib/legal/version";

import { LegalLinks } from "./LegalLinks";

beforeEach(() => {
  draft.on = true;
  for (const k of Object.keys(jarValues)) delete jarValues[k];
});
afterEach(cleanup);

const textOf = (doc: LegalText) => JSON.stringify(doc);

describe("/privacy and /terms (job BH)", () => {
  it.each([
    ["privacy", PrivacyPage, "Privacy Policy"],
    ["terms", TermsPage, "Terms of Use"],
  ] as const)("%s: one h1, the draft banner, the version and the effective-date placeholder", async (_n, Page, title) => {
    render(await Page());
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: title })).toHaveAttribute("lang", "en");
    const banner = screen.getByRole("note");
    expect(banner).toHaveTextContent("Draft, pending legal review.");
    expect(banner).toHaveAttribute("lang", "en");
    expect(document.body.textContent).toContain(`Version ${LEGAL_VERSION}`);
    expect(document.body.textContent).toContain("[EFFECTIVE DATE]");
  });
  it("the banner goes when the owner switches the draft flag off, and nothing else changes", async () => {
    draft.on = false;
    render(await PrivacyPage());
    expect(screen.queryByRole("note")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Privacy Policy" })).toBeInTheDocument();
  });
  it("every placeholder the owner must fill is in the texts and drawn highlighted; none is left unmarked", async () => {
    const all = textOf(PRIVACY) + textOf(TERMS);
    for (const ph of OWNER_PLACEHOLDERS.filter((p) => p !== "[EFFECTIVE DATE]")) expect(all, ph).toContain(ph); // the date is drawn by the page itself (next test)
    render(await PrivacyPage());
    const marks = [...document.querySelectorAll("mark[data-placeholder]")].map((m) => m.textContent);
    for (const ph of OWNER_PLACEHOLDERS.filter((p) => p !== "[EFFECTIVE DATE]")) expect(marks, ph).toContain(ph);
    // every [CAPITAL] bracket in the text is matched by the highlighter
    for (const m of all.matchAll(/\[[A-Z][^\]]*\]/g)) expect(m[0].match(PLACEHOLDER)?.[0], m[0]).toBe(m[0]);
  });
  it("the structure is sound: unique section ids, each in the table of contents, each heading labelled, tables have header cells", async () => {
    for (const [doc, Page] of [[PRIVACY, PrivacyPage], [TERMS, TermsPage]] as const) {
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
    for (const word of ["data fiduciary", "data processor", "Why we use it", "consent", "withdraw", "access", "correction", "erasure", "nominat", "grievance", "How long we keep it", "transfers abroad", "Children", "Data Protection Board", "GDPR", "[GRIEVANCE OFFICER]"]) expect(all.toLowerCase(), word).toContain(word.toLowerCase());
  });
  it("it names what we really keep and who handles it: every group of the data inventory, the processors, voice, the AI, cookies, backups, the do-not-contact keys", () => {
    const all = textOf(PRIVACY);
    for (const word of ["phone number", "e-mail", "job title", "enquiries", "store visits", "call requests", "Agent OWL", "Supabase", "WhatsApp", "speech", "Meta", "recording", "backup", "do-not-contact", "sb-<project>-auth-token", "sme_lang", "sme_theme", "sme_consent", "Settings, Privacy", "24-hour"]) expect(all, word).toContain(word);
  });
  it("it says Agent OWL is an AI and that messages to customers may be written by AI and are labelled, in both texts", () => {
    for (const doc of [PRIVACY, TERMS]) {
      const all = textOf(doc);
      expect(all).toMatch(/Agent OWL[^"]*(is an AI|, the assistant in \{brand\}, is an AI)/);
      expect(all).toMatch(/written by AI[^"]*labelled/);
    }
  });
  it("it makes no promise the product does not keep: no 'compliant', no 'we never', no 'guarantee' of security", () => {
    const all = textOf(PRIVACY);
    expect(all).not.toMatch(/\bcompliant\b|\bcertified\b|military|bank-grade|100%|never be (hacked|breached)/i);
    expect(all).toContain("No service can promise perfect security");
  });
  it("the terms say the AI does not set prices and a person is responsible, and keep the lawyer's items marked", () => {
    const all = textOf(TERMS);
    expect(all).toContain("does not set or change prices");
    expect(all).toContain("[LEGAL REVIEW");
    expect(all).toContain("[CONFIRM");
  });
  it("is public and not for search engines until launch", () => {
    for (const m of [privacyMeta, termsMeta]) expect(m.robots).toEqual({ index: false, follow: false });
  });
});

describe("the summary at the top is in the visitor's language, marked as a machine translation; the legal text stays English (job BH)", () => {
  it.each(["te", "hi", "kn"] as const)("%s", async (lang) => {
    jarValues.sme_lang = lang;
    render(await PrivacyPage());
    const d = legalDict(lang);
    const box = screen.getByRole("heading", { name: d["legal.summary.title"] }).closest("section")!;
    expect(box).toHaveAttribute("lang", lang);
    for (const n of [1, 2, 3, 4, 5] as const) expect(box.textContent).toContain(d[`legal.sum.privacy.${n}` as "legal.sum.privacy.1"]);
    expect(box.textContent).toContain(d["legal.summary.note"]);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Privacy Policy");
    expect(document.getElementById("collect")!.closest("div")).toHaveAttribute("lang", "en");
    expect(screen.getByRole("note")).toHaveTextContent("Draft, pending legal review."); // the banner stays English
  });
  it("English has no 'machine translation' note", async () => {
    render(await TermsPage());
    expect(document.body.textContent).not.toContain("machine-written translation");
  });
  it("the summaries make no claim the product cannot keep (the landing page's own list)", async () => {
    const { FORBIDDEN_CLAIMS } = await import("@/i18n/strings/forbidden");
    for (const lang of LANGS) for (const [k, v] of Object.entries(legalDict(lang))) for (const [re, label] of FORBIDDEN_CLAIMS) expect(re.test(v), `${lang}:${k} ${label}`).toBe(false);
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
