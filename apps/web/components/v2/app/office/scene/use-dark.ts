"use client";

import { useSyncExternalStore } from "react";

function subscribe(cb: () => void): () => void {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const mq = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  mq?.addEventListener("change", cb);
  return () => {
    mo.disconnect();
    mq?.removeEventListener("change", cb);
  };
}

function read(): boolean {
  const choice = document.documentElement.getAttribute("data-theme");
  if (choice === "dark") return true;
  if (choice === "light") return false;
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Whether the page is dark right now: the explicit choice on <html data-theme> (the top bar's button), else the system's. Light on the server. */
export function useDark(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}
