"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";

import type { Consent } from "@/lib/consent/consent";
import { closeCookieSettings, openCookieSettings, saveConsent, settingsOpener, useConsentState } from "@/lib/consent/store";
import { COOKIES } from "@/lib/legal/cookies";

import type { CookieWords } from "./cookie-words";


const button = "inline-flex min-h-11 items-center justify-center rounded-lg border px-4 text-base font-semibold";
const primary = `${button} border-brand-edge bg-brand text-on-brand hover:brightness-95`;
const secondary = `${button} border-edge bg-surface text-ink hover:bg-surface-2`;

function Switch({ checked, disabled, onChange, label, describedBy }: { checked: boolean; disabled?: boolean; onChange?: (v: boolean) => void; label: string; describedBy?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-disabled={disabled || undefined} aria-describedby={describedBy} onClick={() => !disabled && onChange?.(!checked)} className={`inline-flex min-h-11 items-center gap-3 rounded-lg pr-2 text-base font-semibold ${disabled ? "opacity-70" : ""}`}>
      <span aria-hidden="true" className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border ${checked ? "border-brand-edge bg-brand" : "border-edge bg-surface-2"}`}>
        <span className={`absolute size-4 rounded-full shadow ${checked ? "left-6 bg-on-brand" : "left-1 bg-muted"}`} />
      </span>
      {label}
    </button>
  );
}

function Panel({ words, consent }: { words: CookieWords; consent: Consent }) {
  const [analytics, setAnalytics] = React.useState(consent.analytics);
  const heading = React.useRef<HTMLHeadingElement>(null);
  const box = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    heading.current?.focus();
    const back = settingsOpener();
    return () => {
      if (back instanceof HTMLElement && document.contains(back)) back.focus(); // focus goes back to the link that opened it
    };
  }, []);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      closeCookieSettings();
      return;
    }
    if (e.key !== "Tab" || !box.current) return;
    const items = [...box.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled])")];
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === heading.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onKeyDown={onKeyDown} onMouseDown={(e) => e.target === e.currentTarget && closeCookieSettings()}>
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby="cookie-panel-h" data-cookie="panel" className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-line bg-bg p-5 text-ink shadow-[var(--v2-shadow)] sm:rounded-2xl">
        <h2 id="cookie-panel-h" ref={heading} tabIndex={-1} className="font-display text-2xl font-bold outline-none">
          {words["cookie.panel.title"]}
        </h2>

        <section aria-labelledby="cookie-nec-h" className="mt-4">
          <Switch checked disabled label={words["cookie.necessary.title"]} describedBy="cookie-nec-d" />
          <p id="cookie-nec-d" className="text-base text-muted">
            {words["cookie.necessary.text"]}
          </p>
          <h3 id="cookie-nec-h" className="mt-3 text-base font-semibold">
            {words["cookie.list.title"]}
          </h3>
          <div className="mt-2 overflow-x-auto rounded-lg border border-line">
            <table className="w-full border-collapse text-left text-base">
              <thead className="bg-surface-2">
                <tr>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    {words["cookie.col.name"]}
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    {words["cookie.col.what"]}
                  </th>
                </tr>
              </thead>
              <tbody>
                {COOKIES.map((c) => (
                  <tr key={c.name} className="border-t border-line align-top">
                    <th scope="row" className="px-3 py-2 font-mono text-sm font-semibold [overflow-wrap:anywhere]">
                      {c.name}
                    </th>
                    <td className="px-3 py-2">{words[`cookie.ck.${c.key}`]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-label={words["cookie.analytics.title"]} className="mt-5 border-t border-line pt-4">
          <h3 className="text-base font-semibold">{words["cookie.analytics.title"]}</h3>
          <Switch checked={analytics} onChange={setAnalytics} label={words["cookie.analytics.switch"]} describedBy="cookie-an-d" />
          <p id="cookie-an-d" className="text-base text-muted">
            {words["cookie.analytics.text"]}
          </p>
        </section>

        <div className="mt-5 flex flex-wrap gap-3">
          <button type="button" onClick={() => saveConsent(analytics)} className={primary}>
            {words["cookie.save"]}
          </button>
          <button type="button" onClick={closeCookieSettings} className={secondary}>
            {words["cookie.close"]}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The cookie notice and the cookie settings (job BH), mounted once in the root layout. The notice is small and does not block anything (it sits at the end of the page and sticks to the bottom of the window while you scroll, so at the end of a page it is below the footer, never over it): it is shown once, until the visitor presses OK or saves a choice in
 * the settings (the choice is remembered in the `sme_consent` cookie; `initial` is what the server read from it, so a visitor who has answered never sees it, and nothing flickers). The settings panel opens from the
 * "Cookie settings" link of any footer. Analytics is OFF by default and nothing here, or anywhere in the app, loads analytics.
 */
export function CookieConsent({ initial, words }: { initial: Consent; words: CookieWords }) {
  const { consent, settingsOpen } = useConsentState(initial);
  // inside the app a phone has a bottom bar (64 px and the safe area): the notice sits above it, not over it (found by the staging smoke of 26 Oct: on a first visit the notice hid the "More" button)
  const aboveBar = (usePathname() ?? "").startsWith("/app");
  return (
    <>
      {!consent.decided && !settingsOpen ? (
        <section role="region" aria-labelledby="cookie-notice-h" data-cookie="notice" className={`mx-3 mb-3 rounded-xl border border-edge bg-surface p-4 text-ink shadow-[var(--v2-shadow)] sm:ml-auto sm:mr-4 sm:max-w-md ${aboveBar ? "max-md:mb-[calc(4rem+env(safe-area-inset-bottom)+0.75rem)]" : ""}`}>
          <h2 id="cookie-notice-h" className="text-base font-semibold">
            {words["cookie.notice.title"]}
          </h2>
          <p className="mt-1 text-base">{words["cookie.notice.text"]}</p>
          <p className="mt-1">
            <Link href="/privacy" className="inline-flex min-h-11 items-center text-base font-semibold text-brand-text hover:underline">
              {words["cookie.notice.privacy"]}
            </Link>
          </p>
          <div className="mt-2 flex flex-wrap gap-3">
            <button type="button" onClick={() => saveConsent(false)} className={primary}>
              {words["cookie.notice.ok"]}
            </button>
            <button type="button" onClick={openCookieSettings} className={secondary}>
              {words["cookie.panel.title"]}
            </button>
          </div>
        </section>
      ) : null}
      {settingsOpen ? <Panel key="panel" words={words} consent={consent} /> : null}
    </>
  );
}
