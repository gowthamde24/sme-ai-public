"use client";

import { useState, useSyncExternalStore } from "react";

import { THEME_COOKIE } from "@/i18n/preferences";

import { applyTheme, type ThemePick } from "../controls/ThemeChoice";
import { word, type Labels } from "./labels";

const PICKS: readonly ThemePick[] = ["system", "light", "dark"];
const noSubscribe = () => () => undefined;
/** The saved choice (cookie `sme_theme`): none saved = "system" (the page follows the phone). */
function savedPick(): ThemePick {
  const found = document.cookie.split("; ").find((c) => c.startsWith(`${THEME_COOKIE}=`))?.split("=")[1];
  return found === "light" || found === "dark" ? found : "system";
}

/**
 * Appearance: Automatic (follows the phone, the default), Light or Dark (owner, 29 Nov 2026: on a phone that is set to dark the app was dark with no way to change it). Reached from More and from the account menu; the choice is
 * remembered on this device (cookie `sme_theme`) and applied at once, without a reload. The words come with the frame's labels.
 */
export function Appearance({ labels, className = "" }: { labels: Labels; className?: string }) {
  const saved = useSyncExternalStore(noSubscribe, savedPick, () => "system" as ThemePick);
  const [local, setLocal] = useState<ThemePick | null>(null);
  const chosen = local ?? saved;
  const heading = word(labels, "frame.appearance", "Appearance");
  return (
    <div data-part="appearance" className={className}>
      <p className="m-0 mb-2 text-sm font-semibold text-ink">{heading}</p>
      <div className="grid grid-cols-[repeat(3,minmax(0,1fr))] gap-1 rounded-lg border border-line bg-surface p-1">
        {PICKS.map((pick) => (
          <button
            key={pick}
            type="button"
            data-pick={pick}
            aria-pressed={chosen === pick}
            onClick={() => {
              setLocal(pick);
              applyTheme(pick);
            }}
            // three equal segments; the label may wrap or break inside its own segment (Telugu, Hindi, Kannada words are longer) but never runs under the next one (owner screenshot, 26 Nov 2026: "Automatic" ran under the selected "Light")
            className={`inline-flex min-h-11 min-w-0 items-center justify-center overflow-hidden rounded-md px-1 text-center text-[13px] font-semibold leading-tight [overflow-wrap:anywhere] ${chosen === pick ? "bg-charcoal text-on-charcoal" : "text-ink hover:bg-surface-2"}`}
          >
            {word(labels, `frame.theme.${pick}`, pick === "system" ? "Automatic" : pick === "light" ? "Light" : "Dark")}
          </button>
        ))}
      </div>
    </div>
  );
}
