"use client";

import { useEffect } from "react";

/**
 * Registers the offline worker (public/sw.js, job BL) and tells it the person's language so the offline page speaks it. Draws nothing. A browser without service workers, a refused registration or
 * a private window just means no offline page: the app works exactly as before. The development server registers a worker that keeps no files (?dev=1), because its files change under one name.
 * The worker never stores a page or an answer of the API: see the header of public/sw.js.
 */
export function ServiceWorker({ lang }: { lang: string }) {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let cancelled = false;
    const url = process.env.NODE_ENV === "production" ? "/sw.js" : "/sw.js?dev=1";
    navigator.serviceWorker
      .register(url, { scope: "/", updateViaCache: "none" })
      .then(() => navigator.serviceWorker.ready)
      .then((registration) => {
        if (!cancelled) registration.active?.postMessage({ type: "lang", lang });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [lang]);
  return null;
}
