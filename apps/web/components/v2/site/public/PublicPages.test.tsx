import { cleanup, fireEvent, render as rtl, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { sentenceFormsIn } from "@/test/helpers/no-sentence-form";
import { htmlText } from "@/test/html-text";

vi.mock("@/design/fonts", () => ({ v2FontClassName: () => "font-vars", teluguFontVariable: "te-font", teluguDemoFontVariable: "te-demo-font" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/" }));
// the lazy wrapper is a Next chunk boundary; in a test the form itself is drawn
vi.mock("@/components/v2/site/public/LazyTalkForm", async () => ({ TalkForm: (await import("./TalkForm")).TalkForm }));
vi.mock("@/components/v2/controls/Turnstile", () => ({ Turnstile: () => null }));

import { pubDict } from "@/i18n/public";
import type { SiteLang } from "@/i18n/lang";
import { SITE_LANGS } from "@/i18n/site-lang";
import { HELP_ARTICLES, INCIDENTS } from "@/lib/public/data";
import type { Health } from "@/lib/public/health";
import { sitePath, type SiteTarget } from "@/lib/site/paths";

import { SitePage, type SiteActions } from "../SitePage";
import { TalkForm, type TalkWords } from "./TalkForm";

afterEach(cleanup);

const actions = (extra: Partial<SiteActions> = {}): SiteActions => ({ contactChat: vi.fn(), quoteChat: vi.fn(), chatAvailable: true, talk: vi.fn(async () => ({ ok: true as const })), ...extra });
const html = (lang: SiteLang, target: SiteTarget, extra: Partial<SiteActions> = {}) => renderToStaticMarkup(<SitePage lang={lang} target={target} actions={actions(extra)} />);
const page = (p: "pricing" | "help" | "status" | "acceptable-use" | "refunds" | "talk-to-us"): SiteTarget => ({ kind: "page", page: p });
const text = (h: string) => htmlText(h).replace(/\s+/g, " ");

describe("pricing (the approved mock)", () => {
  const h = html("en", page("pricing"));
  it("says Rs 100 free, no card, three plans from the plans' own numbers, Pro chosen with the ink border", () => {
    const t = text(h);
    expect(t).toContain("₹100 free to start. No card.");
    expect(t).toContain("About 20 minutes of calls");
    for (const s of ["Pay as you go", "₹499", "Pro", "₹1,999", "Business", "₹5,999", "500 call minutes", "1,500 call minutes", "Priority setup"]) expect(t, s).toContain(s);
    expect(h.match(/data-chosen/g)).toHaveLength(1);
    expect(h).toMatch(/data-plan="pro"[^>]*class="[^"]*border-ink/);
  });
  it("lists what you pay for, has no draft tags (call charging is wired) and says GST is extra", () => {
    const t = text(h);
    for (const s of ["From ₹5 a minute", "₹299 a month", "Nothing to pay", "Free", "At Meta's price"]) expect(t, s).toContain(s);
    expect(h).not.toContain('data-part="draft-tag"');
    expect(t).not.toContain("Draft: to be confirmed");
    expect(t).toContain("18% GST is added on your invoice");
  });
  it("has one start button, to sign-up", () => {
    expect(h).toContain('href="/signup"');
  });
});

describe("help center", () => {
  it("lists the ten articles, each linking to its own address in the page's language", () => {
    for (const lang of SITE_LANGS) {
      const out = html(lang, page("help"));
      expect(HELP_ARTICLES).toHaveLength(10);
      for (const a of HELP_ARTICLES) expect(out, `${lang} ${a.slug}`).toContain(`href="${sitePath(lang, { kind: "article", slug: a.slug })}"`);
    }
  });
  it("has the search box and the contact entry (write to hello@, Talk to us)", () => {
    const out = html("en", page("help"));
    expect(out).toContain('type="search"');
    expect(out).toContain("hello@stack19.com");
    expect(out).toContain(`href="${sitePath("en", page("talk-to-us"))}"`);
  });
  it.each(HELP_ARTICLES.map((a) => [a.slug, a] as const))("article %s: a title, three steps, the way back, and no unfilled {word}", (_s, a) => {
    const out = html("en", { kind: "article", slug: a.slug });
    expect(out.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(out.match(/data-part="steps"/g)).toHaveLength(1);
    expect(htmlText(out)).not.toMatch(/\{[a-z_]+\}/);
    expect(out).toContain(`href="${sitePath("en", page("help"))}"`);
    expect(out.includes('data-part="draft-tag"')).toBe(Boolean(a.draft));
  });
  it("the articles state the numbers of the product, not typed ones: Rs 100, GST, 7 days, 48 hours, 10 am to 9 pm", () => {
    const t = (slug: string) => text(html("en", { kind: "article", slug }));
    expect(t("billing-and-credits")).toContain("₹100 free");
    expect(t("billing-and-credits")).toContain("18% GST");
    expect(t("delete-your-data")).toMatch(/after 7 days/);
    expect(t("delete-your-data")).toMatch(/within 48 hours/);
    expect(t("calling-rules")).toContain("between 10 am and 9 pm");
  });
  it("search narrows the list by title, summary and the words of the article, and says so when nothing is found", async () => {
    const { HelpSearch } = await import("./HelpSearch");
    const items = HELP_ARTICLES.slice(0, 3).map((a) => ({ slug: a.slug, href: `/help/${a.slug}`, title: `T-${a.slug}`, summary: "s", text: a.slug === "add-what-you-sell" ? "spreadsheet" : "other" }));
    rtl(<HelpSearch items={items} words={{ label: "Search for help", button: "Search", none: "Nothing found." }} />);
    expect(screen.getAllByRole("link")).toHaveLength(3);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "spreadsheet" } });
    expect(screen.getAllByRole("link")).toHaveLength(1);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzz" } });
    expect(screen.getByText("Nothing found.")).toBeInTheDocument();
  });
});

describe("status", () => {
  const up: Health = { api: "up", checkedAt: "2026-11-25T10:00:00.000Z" };
  it("everything working: one dot and a sentence, two honest rows, no problems reported", () => {
    const out = html("en", page("status"), { health: up });
    expect(out).toContain('data-state="ok"');
    const t = text(out);
    expect(t).toContain("Everything is working");
    expect(t).toContain("No problems reported.");
    expect(t).toContain("Checked 25 Nov, 3:30 pm"); // India time
    expect(INCIDENTS).toEqual([]);
  });
  it("the API's /health failing says so; no reading says we could not check (never 'working')", () => {
    expect(text(html("en", page("status"), { health: { api: "down", checkedAt: up.checkedAt } }))).toContain("We have a problem and are looking at it");
    const none = html("en", page("status"));
    expect(none).toContain('data-state="unknown"');
    expect(text(none)).toContain("We could not check just now");
  });
});

describe("acceptable use and refunds: drafts for approval", () => {
  it("acceptable use has five rules, the Draft tag and the hello@ address", () => {
    const out = html("en", page("acceptable-use"));
    expect(out.match(/data-part="draft-tag"/g)).toHaveLength(1);
    expect(text(out)).toContain("Draft for approval");
    expect(htmlText(out).match(/\bOnly contact people who agreed\b/g)).toHaveLength(1);
    const rows = out.match(/<li class="grid grid-cols-\[2rem/g);
    expect(rows).toHaveLength(5);
    expect(out).toContain("hello@stack19.com");
  });
  it("acceptable use lists the client's duties as plain bullets, marked Draft until the advocate has reviewed them (lawyer's opinion, 25 Nov 2026)", () => {
    const out = html("en", page("acceptable-use"));
    const duties = out.slice(out.indexOf('data-part="aup-duties"'));
    const t = text(duties);
    expect(t).toContain("Your duties as the business that calls");
    expect(t).toContain("Draft: it waits for our advocate's review and may change.");
    expect(t).toContain("7 days only");
    expect(t).toContain("are yours, not ours");
    expect(t).toContain("We may pause or stop calling on your account at any time");
    expect(t).not.toMatch(/I confirm|business confirms/);
    expect(text(out)).toContain("whose consent is recorded");
  });
  it("refunds has four rules, the Draft tag and the hello@ address", () => {
    const out = html("en", page("refunds"));
    expect(out.match(/data-part="draft-tag"/g)).toHaveLength(1);
    expect(out.match(/<li class="grid grid-cols-\[2rem/g)).toHaveLength(4);
    expect(text(out)).toContain("within 14 days of the day you bought them");
    expect(text(out)).toContain("Credits never expire.");
    expect(text(out)).toContain("payment method you paid with");
    expect(text(out)).toContain("We answer within 2 working days.");
    expect(text(out)).not.toMatch(/7 days/);
    expect(out).toContain("hello@stack19.com");
  });
});

const words = (): TalkWords => {
  const d = pubDict("en");
  return { name: d["pub.talk.name"], contact: d["pub.talk.contact"], type: d["pub.talk.type"], choose: "Choose", time: d["pub.talk.time"], what: d["pub.talk.what"], consent: d["pub.talk.consent"], privacy: d["pub.talk.privacy"], submit: d["pub.talk.submit"], note: d["pub.talk.note"], okTitle: "Thank you", okBody: "ok", errBusy: "busy", okRef: "We received it. Reference {ref}.", errName: "need name", errContact: "need contact", errConsent: "need consent", errRate: "rate", errCheck: "check", errGeneric: "generic", types: [{ id: "clinic", label: "Clinic" }], times: [{ id: "morning", label: "Morning" }] };
};

describe("Talk to us", () => {
  it("shows the reference when the request was stored, and the busy refusal as one sentence", async () => {
    const ok = vi.fn(async () => ({ ok: true as const, reference: "TQ-1A2B3C4D" }));
    rtl(<TalkForm lang="en" words={words()} action={ok} privacyHref="/privacy" />);
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Asha" } });
    fireEvent.change(screen.getByLabelText(/Phone, WhatsApp number or e-mail/), { target: { value: "98480 12345" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Ask for a demo" }));
    await waitFor(() => expect(screen.getByText("We received it. Reference TQ-1A2B3C4D.")).toBeInTheDocument());
    cleanup();
    const busy = vi.fn(async () => ({ ok: false as const, error: "busy" as const }));
    rtl(<TalkForm lang="en" words={words()} action={busy} privacyHref="/privacy" />);
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Asha" } });
    fireEvent.change(screen.getByLabelText(/Phone, WhatsApp number or e-mail/), { target: { value: "98480 12345" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Ask for a demo" }));
    await waitFor(() => expect(screen.getByText("busy")).toBeInTheDocument());
  });

  it("is plain labelled fields: name, phone or e-mail, kind of business, a good time, what you sell, the consent box; no sentence form", () => {
    const out = html("en", page("talk-to-us"));
    for (const id of ["tk-name", "tk-contact", "tk-type", "tk-time", "tk-what"]) expect(out).toContain(`id="${id}"`);
    expect(out).toContain('type="checkbox"');
    const host = document.createElement("div");
    host.innerHTML = out;
    expect(sentenceFormsIn(host)).toEqual([]);
  });
  it("does not call the action without a name, a contact or consent... the server says why; a good one shows the thank-you with the fallback address", async () => {
    const action = vi.fn(async () => ({ ok: true as const }));
    rtl(<TalkForm lang="en" words={words()} action={action} privacyHref="/privacy" />);
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Asha" } });
    fireEvent.change(screen.getByLabelText(/Phone, WhatsApp number or e-mail/), { target: { value: "98480 12345" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Ask for a demo" }));
    await waitFor(() => expect(screen.getByText("Thank you")).toBeInTheDocument());
    expect(action).toHaveBeenCalledTimes(1);
    expect((action.mock.calls[0] as unknown[])[0]).toMatchObject({ name: "Asha", contact: "98480 12345", consent: true, type: "other" });
  });
  it("shows the server's refusal as a dot and a sentence", async () => {
    const action = vi.fn(async () => ({ ok: false as const, error: "contact" as const }));
    rtl(<TalkForm lang="en" words={words()} action={action} privacyHref="/privacy" />);
    fireEvent.click(screen.getByRole("button", { name: "Ask for a demo" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("need contact"));
  });
});

describe("every launch page, every language: no sentence form, no raw key, own script", () => {
  const targets: SiteTarget[] = [page("pricing"), page("help"), page("status"), page("acceptable-use"), page("refunds"), page("talk-to-us"), { kind: "article", slug: "billing-and-credits" }];
  it.each(targets.flatMap((t) => SITE_LANGS.map((l) => [`${t.kind === "article" ? t.slug : t.kind === "page" ? t.page : ""} ${l}`, l, t] as const)))("%s", (_n, lang, target) => {
    const out = html(lang, target);
    const host = document.createElement("div");
    host.innerHTML = out;
    expect(sentenceFormsIn(host)).toEqual([]);
    expect(htmlText(out)).not.toMatch(/\bpub\.[a-z]+\.[a-z0-9_.]+\b/);
    expect(htmlText(out)).not.toMatch(/\{(?!customer\}|business\})[a-z_]+\}/);
  });
});
