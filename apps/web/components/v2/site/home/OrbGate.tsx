"use client";

import * as React from "react";

const QUERY = "(min-width: 768px)";
const subscribe = (cb: () => void) => {
  const m = window.matchMedia(QUERY);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};

/**
 * Mounts its children only from 768 px up (owner, 21 Nov 2026: "remove the hero voice orb from the mobile version"): on a phone the orb, its sources, its caption and its animation are not rendered, not scripted and not painted
 * (not merely hidden). The server markup is empty; the slot keeps the stage's shape (the style sheet reserves it from 768 px), so nothing shifts when the stage mounts on a tablet or a desktop.
 */
export function OrbGate({ children }: { children: React.ReactNode }) {
  const wide = React.useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false);
  return wide ? <>{children}</> : null;
}
