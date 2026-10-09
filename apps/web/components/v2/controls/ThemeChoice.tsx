"use client";

import { useState } from "react";

import { THEME_COOKIE, serializePreference, type Theme } from "@/i18n/preferences";

export type ThemePick = Theme | "system";

/** Saves the choice (or forgets it, for System) and flips data-theme on every v2 wrapper and on <html> at once. */
function applyTheme(pick: ThemePick): void {
  const secure = window.location.protocol === "https:";
  const effective: Theme = pick === "system" ? (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light") : pick;
  document.cookie = pick === "system" ? `${THEME_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure ? "; Secure" : ""}` : serializePreference(THEME_COOKIE, pick, secure);
  document.querySelectorAll('[data-ui="v2"]').forEach((el) => (pick === "system" ? el.removeAttribute("data-theme") : el.setAttribute("data-theme", effective)));
  document.documentElement.setAttribute("data-theme", effective);
}

/**
 * The look: System, Light or Dark, as three buttons (Settings, "Language and look"). Light and Dark save the functional cookie `sme_theme` and flip data-theme at once (as the top bar's button
 * does); System forgets the choice, so the page follows the device again. The words arrive from the server in the person's language.
 */
export function ThemeChoice({ initial, label, words }: { initial: ThemePick; label: string; words: Record<ThemePick, string> }) {
  const [chosen, setChosen] = useState<ThemePick>(initial);
  const apply = (pick: ThemePick) => {
    setChosen(pick);
    applyTheme(pick);
  };
  return (
    <div role="group" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-lg border border-edge bg-surface p-1">
      {(["system", "light", "dark"] as const).map((pick) => (
        <button key={pick} type="button" aria-pressed={chosen === pick} onClick={() => apply(pick)} className={`inline-flex min-h-11 items-center rounded-md px-4 text-sm font-semibold ${chosen === pick ? "bg-charcoal text-on-charcoal" : "text-ink hover:bg-surface-2"}`}>
          {words[pick]}
        </button>
      ))}
    </div>
  );
}
