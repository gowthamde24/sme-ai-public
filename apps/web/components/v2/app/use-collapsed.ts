"use client";

import { useSyncExternalStore } from "react";

const KEY = "sme_menu_collapsed";
const listeners = new Set<() => void>();
const NARROW = "(max-width: 1024px)";

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
    return v === "1" || v === "0" ? v : null;
  } catch {
    return null;
  }
}
const snapshot = (): string => stored() ?? (window.matchMedia?.(NARROW).matches ? "1" : "0");

/**
 * Whether the side menu is the narrow rail: what the person chose last time (kept in this browser, try/catch: it works without storage), else the narrow rail
 * on a tablet (1024px and under) and the full menu above. The first (server) render is the full menu; the browser's value arrives after hydration.
 */
export function useCollapsed(): [boolean, () => void] {
  const collapsed = useSyncExternalStore(subscribe, snapshot, () => "0") === "1";
  const toggle = () => {
    try {
      window.localStorage.setItem(KEY, collapsed ? "0" : "1");
    } catch {
      /* no storage: the choice lasts until the page is reloaded */
    }
    listeners.forEach((l) => l());
  };
  return [collapsed, toggle];
}
