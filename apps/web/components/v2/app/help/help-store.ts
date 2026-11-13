"use client";

import { useEffect, useSyncExternalStore } from "react";

/** The tip of the screen that is open now: its three lines and the way to its guide, in the person's language. The screen registers it (HelpTip draws nothing in the page); the "?" in the top bar shows it. */
export type ScreenTip = { screen: string; label: string; lines: readonly string[]; moreHref: string; moreLabel: string; closeLabel: string; /** Design system v6: the way to the support chat on WhatsApp for this screen (a redirect route of ours; no number in the page), and its words. */ supportHref?: string; supportLabel?: string };

let current: ScreenTip | null = null;
const listeners = new Set<() => void>();
const set = (next: ScreenTip | null) => {
  current = next;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The tip of the screen being shown, or null (a screen with no tip: the "?" then opens the list of guides). */
export function useScreenTip(): ScreenTip | null {
  return useSyncExternalStore(subscribe, () => current, () => null);
}

/** While the screen is mounted, `tip` is what the "?" shows. */
export function useRegisterTip(tip: ScreenTip): void {
  const { screen, label, lines, moreHref, moreLabel, closeLabel, supportHref, supportLabel } = tip;
  const key = `${screen}|${moreHref}|${supportHref ?? ""}|${lines.join("|")}`;
  useEffect(() => {
    set({ screen, label, lines, moreHref, moreLabel, closeLabel, ...(supportHref ? { supportHref, supportLabel } : {}) });
    return () => set(null);
    // (the key stands for the whole tip: a new screen, a new language)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
