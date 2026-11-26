"use client";

import { useSyncExternalStore } from "react";

const KEY = "sme_menu_collapsed";
const listeners = new Set<() => void>();
const NARROW = "(max-width: 1024px)";
let heldHere: "1" | "0" | null = null; // a browser with no storage (a private window): the choice lasts for this page only

function subscribe(notify: () => void) {
  listeners.add(notify);
  window.addEventListener("storage", notify);
  const mq = window.matchMedia?.(NARROW);
  mq?.addEventListener?.("change", notify);
  return () => {
    listeners.delete(notify);
    window.removeEventListener("storage", notify);
    mq?.removeEventListener?.("change", notify);
  };
}
function stored(): "1" | "0" | null {
  try {
    const v = window.localStorage.getItem(KEY);
    if (v === "1" || v === "0") return v;
  } catch {
    /* no storage: the choice made on this page */
  }
  return heldHere;
}
const snapshotNarrow = (): string => stored() ?? (window.matchMedia?.(NARROW).matches ? "1" : "0");
const snapshotWide = (): string => stored() ?? "0";

/**
 * Whether the side menu is the narrow rail: what the person chose last time (kept in this browser, try/catch: it works without storage), else, with `narrowDefault`, the narrow rail
 * on a tablet (1024px and under) and the full menu above. The design system's menu (v6) passes `false`: it is the full menu until the person closes it with the button at its top.
 * The first (server) render is the full menu; the browser's value arrives after hydration (no mismatch: it is a store, read the same way on both sides).
 */
export function useCollapsed(narrowDefault = true): [boolean, () => void] {
  const collapsed = useSyncExternalStore(subscribe, narrowDefault ? snapshotNarrow : snapshotWide, () => "0") === "1";
  const toggle = () => {
    const next = collapsed ? "0" : "1";
    try {
      window.localStorage.setItem(KEY, next);
      heldHere = null;
    } catch {
      heldHere = next;
    }
    listeners.forEach((l) => l());
  };
  return [collapsed, toggle];
}
