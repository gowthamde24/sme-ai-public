"use client";

import Link from "next/link";
import * as React from "react";
import { createPortal } from "react-dom";

/** The icons are drawn by the server (SiteHeader) and passed in, so the page's script carries no icon code for the menu. */
export type SheetItem = { href: string; label: string; icon: React.ReactNode; here?: boolean };

/**
 * The menu of a phone (under 900 px): a button in the bar that opens a SHEET with the sections and small icons, the sign-in link, the language and theme controls (passed in as children, already drawn on the server) and a full-width
 * call to action at the bottom. A dialog: the focus goes to the close button and stays inside (Tab and Shift+Tab loop), Escape closes it and returns the focus to the menu button, the page behind does not scroll, a tap on a link or
 * on the dark backdrop closes it. Light and dark follow the page's tokens.
 */
export function HeaderSheet({ label, closeLabel, items, login, cta, icons, children }: { label: string; closeLabel: string; items: SheetItem[]; icons: { menu: React.ReactNode; close: React.ReactNode; login: React.ReactNode }; login?: { href: string; label: string }; cta: { href: string; label: string }; children?: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  // the sheet is drawn into the v2 root (not inside the header: a header with a blurred background would clip a fixed panel to its own box)
  const [root, setRoot] = React.useState<Element | null>(null);
  const button = React.useRef<HTMLButtonElement>(null);
  const panel = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = button.current?.closest('[data-ui="v2"]') ?? null;
    const id = window.setTimeout(() => setRoot(el), 0);
    return () => window.clearTimeout(id);
  }, []);
  const close = React.useCallback(() => {
    setOpen(false);
    button.current?.focus();
  }, []);
  React.useEffect(() => {
    if (!open || !root) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusables = () => [...(panel.current?.querySelectorAll<HTMLElement>('a[href],button:not([disabled]):not([tabindex="-1"]),select,input,[tabindex="0"]') ?? [])];
    focusables()[0]?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "Tab") {
        const f = focusables();
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = prev;
    };
  }, [open, root, close]);
  return (
    <>
      <button ref={button} type="button" aria-expanded={open} aria-haspopup="dialog" aria-controls={open ? "site-menu" : undefined} onClick={() => setOpen(true)} className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-lg border border-edge bg-surface text-ink hover:bg-surface-2 min-[900px]:hidden" data-part="menu-button">
        {icons.menu}
        <span className="sr-only">{label}</span>
      </button>
      {open && root
        ? createPortal(
        <div className="h3-sheet" data-part="menu-sheet">
          <button type="button" className="h3-sheet-backdrop" tabIndex={-1} aria-hidden="true" onClick={close} />
          <div ref={panel} id="site-menu" role="dialog" aria-modal="true" aria-label={label} className="h3-sheet-panel">
            <div className="h3-sheet-top">
              <span className="h3-sheet-title">{label}</span>
              <button type="button" onClick={close} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-edge bg-surface text-ink" data-part="menu-close">
                {icons.close}
                <span className="sr-only">{closeLabel}</span>
              </button>
            </div>
            <nav aria-label={label}>
              <ul className="h3-sheet-list">
                {items.map((n) => {
                  return (
                    <li key={n.href}>
                      <Link href={n.href} onClick={() => setOpen(false)} aria-current={n.here ? "page" : undefined} className="h3-sheet-link">
                        {n.icon}
                        {n.label}
                      </Link>
                    </li>
                  );
                })}
                {login ? (
                  <li>
                    <Link href={login.href} onClick={() => setOpen(false)} className="h3-sheet-link">
                      {icons.login}
                      {login.label}
                    </Link>
                  </li>
                ) : null}
              </ul>
            </nav>
            {children ? <div className="h3-sheet-tools">{children}</div> : null}
            <Link href={cta.href} onClick={() => setOpen(false)} className="h3-btn h3-btn-main h3-btn-block h3-sheet-cta">
              {cta.label}
            </Link>
          </div>
        </div>,
        root,
      )
        : null}
    </>
  );
}
