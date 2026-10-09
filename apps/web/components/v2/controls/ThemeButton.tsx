"use client";

import { Moon, Sun } from "lucide-react";
import { useState } from "react";

import { useMedia } from "@/components/v2/landing/hooks";
import { control } from "@/components/v2/landing/ui";
import { THEME_COOKIE, serializePreference, type Theme } from "@/i18n/preferences";

/**
 * The theme control. With no saved choice the page follows the system and the server cannot know which one that is, so
 * the button starts with the light-mode label and corrects itself after mount (an update, not a hydration mismatch).
 * A click saves the functional cookie `sme_theme` and flips data-theme on every v2 wrapper and on <html> at once; no reload.
 */
export function ThemeButton({ initial, toDark, toLight }: { initial?: Theme; toDark: string; toLight: string }) {
  const systemDark = useMedia("(prefers-color-scheme: dark)"); // false on the server, the real value after mount
  const [chosen, setChosen] = useState<Theme | undefined>(initial);
  const mode: Theme = chosen ?? (systemDark ? "dark" : "light");
  return (
    <button
      type="button"
      onClick={() => {
        const next: Theme = mode === "dark" ? "light" : "dark";
        setChosen(next);
        document.cookie = serializePreference(THEME_COOKIE, next, window.location.protocol === "https:");
        // every v2 wrapper on the page (the workspace frame and a migrated screen are separate wrappers) and <html>, which the legacy screens follow
        document.querySelectorAll('[data-ui="v2"]').forEach((el) => el.setAttribute("data-theme", next));
        document.documentElement.setAttribute("data-theme", next);
      }}
      aria-label={mode === "dark" ? toLight : toDark}
      className={`${control} size-11 shrink-0`}
    >
      {mode === "dark" ? <Sun className="size-5" aria-hidden="true" /> : <Moon className="size-5" aria-hidden="true" />}
    </button>
  );
}
