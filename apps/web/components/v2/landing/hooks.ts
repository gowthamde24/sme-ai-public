"use client";

import { useSyncExternalStore } from "react";

/** A media query as state. The server snapshot is `false`, so markup never depends on it: only behaviour does. */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", notify);
      return () => mql.removeEventListener("change", notify);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
