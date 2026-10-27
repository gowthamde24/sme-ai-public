"use client";

import { useEffect, useRef } from "react";

type Api = { render: (el: HTMLElement, o: Record<string, unknown>) => string; reset: (id: string) => void; remove: (id: string) => void };
const SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let loading: Promise<Api> | null = null;

/** Cloudflare's script, loaded once, by this script (the page's policy trusts what its own nonced script loads: 'strict-dynamic'). */
function load(): Promise<Api> {
  loading ??= new Promise<Api>((resolve, reject) => {
    const ready = (window as unknown as { turnstile?: Api }).turnstile;
    if (ready) return resolve(ready);
    const s = document.createElement("script");
    s.src = SRC;
    s.async = true;
    s.onload = () => ((window as unknown as { turnstile?: Api }).turnstile ? resolve((window as unknown as { turnstile: Api }).turnstile) : reject(new Error("turnstile")));
    s.onerror = () => {
      loading = null;
      reject(new Error("turnstile"));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/**
 * The Cloudflare Turnstile box (public forms): draws the widget for `siteKey` and tells the form its token (`onToken(token)`), or `null` when the token ran out or the check failed. The widget asks for a fresh token again when `again`
 * changes (a token is good for one try). Drawn only where the server turned the check on; the language of the widget follows the page. Nothing is stored.
 */
export function Turnstile({ siteKey, lang, onToken, again = 0 }: { siteKey: string; lang: string; onToken: (token: string | null) => void; again?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const api = useRef<Api | null>(null);
  const report = useRef(onToken);
  useEffect(() => {
    report.current = onToken;
  });
  useEffect(() => {
    let gone = false;
    void load()
      .then((t) => {
        if (gone || !box.current) return;
        api.current = t;
        widget.current = t.render(box.current, { sitekey: siteKey, language: lang, theme: "auto", callback: (v: string) => report.current(v), "expired-callback": () => report.current(null), "error-callback": () => report.current(null) });
      })
      .catch(() => report.current(null));
    return () => {
      gone = true;
      if (widget.current && api.current) api.current.remove(widget.current);
    };
  }, [siteKey, lang]);
  useEffect(() => {
    if (again > 0 && widget.current && api.current) {
      report.current(null);
      api.current.reset(widget.current);
    }
  }, [again]);
  return <div ref={box} data-part="turnstile" className="min-h-[65px]" />;
}
