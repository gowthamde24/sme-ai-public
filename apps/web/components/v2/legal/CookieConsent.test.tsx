import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ path: "/privacy" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.path }));

import { legalT } from "@/i18n/legal";
import { CONSENT_COOKIE, NOT_ASKED, readConsent, cookieFrom } from "@/lib/consent/consent";
import { resetConsentStore } from "@/lib/consent/store";

import { CookieConsent } from "./CookieConsent";
import { COOKIE_WORD_KEYS } from "./cookie-words";
import { CookieSettingsLink } from "./CookieSettingsLink";

const wordsFor = (lang: "en" | "te" | "hi" | "kn" = "en") => Object.fromEntries(COOKIE_WORD_KEYS.map((k) => [k, legalT(lang)(k)]));
const stored = () => readConsent(cookieFrom(document.cookie, CONSENT_COOKIE));
const mount = (initial = NOT_ASKED, lang: "en" | "te" | "hi" | "kn" = "en") =>
  render(
    <div>
      <CookieConsent initial={initial} words={wordsFor(lang)} />
      <footer>
        <CookieSettingsLink label="Cookie settings" className="min-h-11" />
      </footer>
    </div>,
  );
const footerLink = () => within(document.querySelector("footer")!).getByRole("button", { name: "Cookie settings" });
const notice = () => document.querySelector('[data-cookie="notice"]');

beforeEach(() => {
  nav.path = "/privacy";
  document.cookie = `${CONSENT_COOKIE}=; Path=/; Max-Age=0`;
  resetConsentStore();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the cookie notice (job BH)", () => {
  it("is shown to a first-time visitor: small, in plain words, with a link to the Privacy notice and no blocking wall", () => {
    mount();
    const n = notice() as HTMLElement;
    expect(n).not.toBeNull();
    expect(n).toHaveAttribute("role", "region");
    expect(n).not.toHaveAttribute("aria-modal");
    expect(within(n).getByText(/only the cookies this site needs to work/)).toBeInTheDocument();
    expect(within(n).getByText(/no advertising or tracking cookies/)).toBeInTheDocument();
    expect(within(n).getByRole("link", { name: "Read the Privacy notice" })).toHaveAttribute("href", "/privacy");
    expect(n.className).not.toContain("fixed"); // in the flow of the page (the root layout makes its wrapper sticky), so it never covers the footer
    expect(document.querySelector('[role="dialog"]')).toBeNull(); // not a wall: no dialog, no backdrop
    expect(document.querySelector(".bg-black\\/50")).toBeNull();
  });
  it("is not shown to a visitor who has answered (the server read the cookie)", () => {
    mount({ decided: true, analytics: false });
    expect(notice()).toBeNull();
  });
  it("OK dismisses it, remembers the choice in the cookie (analytics OFF), and it does not come back on a new page", () => {
    const { unmount } = mount();
    fireEvent.click(screen.getByRole("button", { name: "OK, got it" }));
    expect(notice()).toBeNull();
    expect(document.cookie).toContain("sme_consent=1.a0");
    expect(stored()).toEqual({ decided: true, analytics: false });
    unmount();
    resetConsentStore();
    mount(readConsent(cookieFrom(document.cookie, CONSENT_COOKIE))); // the next page: the server reads the cookie
    expect(notice()).toBeNull();
  });
  it("even if the browser will not store the cookie, the notice can be dismissed for this page", () => {
    vi.spyOn(document, "cookie", "set").mockImplementation(() => {
      throw new Error("blocked");
    });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "OK, got it" }));
    expect(notice()).toBeNull();
  });
  it("the controls are 44 px tall and the words come in the visitor's language (the privacy link too)", () => {
    mount(NOT_ASKED, "hi");
    const n = notice() as HTMLElement;
    for (const el of n.querySelectorAll("button, a")) expect(el.className, el.textContent ?? "").toMatch(/min-h-11/);
    expect(n.textContent).toContain(legalT("hi")("cookie.notice.ok"));
    expect(n.textContent).not.toContain("OK, got it");
  });
});

describe("the cookie settings (job BH)", () => {
  it("open from the footer link; Analytics is OFF by default; the necessary cookies are listed and cannot be turned off", () => {
    mount({ decided: true, analytics: false });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    fireEvent.click(footerLink());
    const d = screen.getByRole("dialog", { name: "Cookie settings" });
    expect(d).toHaveAttribute("aria-modal", "true");
    const sw = within(d).getAllByRole("switch");
    expect(sw).toHaveLength(2);
    expect(within(d).getByRole("switch", { name: "Strictly necessary" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(within(d).getByRole("switch", { name: "Strictly necessary" }));
    expect(within(d).getByRole("switch", { name: "Strictly necessary" })).toHaveAttribute("aria-checked", "true");
    expect(within(d).getByRole("switch", { name: "Allow analytics" })).toHaveAttribute("aria-checked", "false");
    expect(d.textContent).toContain("We do not use any analytics today, so nothing is loaded.");
    for (const name of ["sb-<project>-auth-token", "sme_lang", "sme_theme", "sme_consent"]) expect(within(d).getByRole("rowheader", { name })).toBeInTheDocument();
  });
  it("the Analytics switch moves; Save writes the choice (on) and closes; the choice is the one remembered", () => {
    mount();
    fireEvent.click(footerLink());
    const d = screen.getByRole("dialog");
    fireEvent.click(within(d).getByRole("switch", { name: "Allow analytics" }));
    expect(within(d).getByRole("switch", { name: "Allow analytics" })).toHaveAttribute("aria-checked", "true");
    expect(document.cookie).not.toContain("sme_consent=1.a1"); // nothing is saved until Save
    fireEvent.click(within(d).getByRole("button", { name: "Save my choice" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(stored()).toEqual({ decided: true, analytics: true });
    expect(notice()).toBeNull();
    fireEvent.click(footerLink()); // opens with the saved choice
    expect(screen.getByRole("switch", { name: "Allow analytics" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("switch", { name: "Allow analytics" }));
    fireEvent.click(screen.getByRole("button", { name: "Save my choice" }));
    expect(stored()).toEqual({ decided: true, analytics: false });
  });
  it("Close, Escape and a click outside leave the choice as it was", () => {
    mount();
    for (const close of [() => fireEvent.click(screen.getByRole("button", { name: "Close" })), () => fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" }), () => fireEvent.mouseDown(document.querySelector(".fixed.inset-0")!)]) {
      fireEvent.click(footerLink());
      fireEvent.click(screen.getByRole("switch", { name: "Allow analytics" }));
      close();
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.cookie).not.toContain("sme_consent");
    }
  });
  it("opening it from the notice's own button shows the panel instead of the notice, and Save answers the notice", () => {
    mount();
    fireEvent.click(within(notice() as HTMLElement).getByRole("button", { name: "Cookie settings" }));
    expect(notice()).toBeNull();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save my choice" }));
    expect(notice()).toBeNull();
    expect(stored()).toEqual({ decided: true, analytics: false });
  });
  it("moves focus to the heading, keeps Tab inside, and gives focus back to the link that opened it", () => {
    mount({ decided: true, analytics: false });
    const link = footerLink();
    link.focus();
    fireEvent.click(link);
    const d = screen.getByRole("dialog");
    expect(document.activeElement).toBe(within(d).getByRole("heading", { name: "Cookie settings" }));
    const buttons = [...d.querySelectorAll<HTMLElement>("a[href], button")]; // everything Tab can reach, switches included
    const last = buttons[buttons.length - 1];
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(buttons[0]);
    buttons[0].focus();
    fireEvent.keyDown(buttons[0], { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(d, { key: "Escape" });
    expect(document.activeElement).toBe(link);
  });
  it("every control is 44 px tall; in Telugu the panel is in Telugu and the cookie names stay as they are", () => {
    mount({ decided: true, analytics: false }, "te");
    fireEvent.click(footerLink());
    const d = screen.getByRole("dialog");
    for (const b of within(d).getAllByRole("button")) expect(b.className, b.textContent ?? "").toMatch(/min-h-11/);
    expect(d.textContent).toContain(legalT("te")("cookie.panel.title"));
    expect(within(d).getByRole("rowheader", { name: "sme_lang" })).toBeInTheDocument();
  });
  it("the panel is in the page, not another site: nothing is fetched while the notice and panel are used", () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    mount();
    fireEvent.click(footerLink());
    fireEvent.click(screen.getByRole("switch", { name: "Allow analytics" }));
    fireEvent.click(screen.getByRole("button", { name: "Save my choice" }));
    expect(fetcher).not.toHaveBeenCalled();
    expect(document.querySelector("script[src], iframe, img[src^='http']")).toBeNull();
    vi.unstubAllGlobals();
  });
});

describe("a second window of the same page", () => {
  it("a choice saved in one place shows in the other (they share the store)", async () => {
    mount();
    expect(notice()).not.toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "OK, got it" }));
    });
    expect(notice()).toBeNull();
  });
});

describe("the notice and the phone's bottom bar (found by the staging smoke of 26 Oct)", () => {
  it("inside the app the notice sits above the bottom bar (64 px and the safe area), not over its More button; on the public pages it is where it was", () => {
    nav.path = "/app/tenants/T/orders";
    mount();
    expect(notice()?.className).toContain("max-md:mb-[calc(4rem+env(safe-area-inset-bottom)+0.75rem)]");
    cleanup();
    resetConsentStore();
    nav.path = "/pricing";
    mount();
    expect(notice()?.className).not.toContain("safe-area-inset-bottom");
  });
});
