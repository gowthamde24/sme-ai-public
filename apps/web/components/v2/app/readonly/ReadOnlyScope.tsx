"use client";

import { usePathname, useSearchParams } from "next/navigation";
import * as React from "react";

import { keepsControls, switchOff, switchOn } from "./read-only-rules";

/**
 * Switches off every edit, send, AI and call control of the screen while the workspace is read-only (job DP; the rules are in read-only-rules.ts). It renders nothing: it watches the page's own part of the frame
 * (`#main-content`), switches off what appears (a list that loads, a card that opens) and puts everything back when the person goes to a screen that keeps its controls or the workspace is paid. A link that is off
 * cannot be followed. `why` is the one short sentence each switched-off control carries as its tooltip.
 */
export function ReadOnlyScope({ why }: { why: string }) {
  const pathname = usePathname() ?? "";
  const section = useSearchParams()?.get("section") ?? null;
  const keep = keepsControls(pathname, section);
  React.useEffect(() => {
    const root = document.getElementById("main-content");
    if (!root || keep) return;
    switchOff(root, why);
    let queued = false;
    const watch = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        switchOff(root, why);
      });
    });
    watch.observe(root, { childList: true, subtree: true });
    const block = (e: Event) => {
      if ((e.target as Element | null)?.closest?.("a[data-readonly-off]")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener("click", block, true);
    return () => {
      watch.disconnect();
      document.removeEventListener("click", block, true);
      switchOn(root);
    };
  }, [keep, why, pathname, section]);
  return null;
}
