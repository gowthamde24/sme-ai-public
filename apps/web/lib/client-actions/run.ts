import { LANG_COOKIE, THEME_COOKIE, serializePreference } from "@/i18n/preferences";

import type { ClientAction } from "./registry";

/**
 * Runs one registry action in the browser and says how to take it back. The browser pieces are handed in (the router, the Talk live switch) so this file stays testable. `undo` is null when there is nothing to undo
 * (the chip then says "Back": a page the assistant opened is left with the browser's back).
 */
export type RunDeps = { base: string; pathname: string; push: (href: string) => void; refresh: () => void; setTalking: (on: boolean) => void };
export type Ran = { undo: (() => void) | null; back: boolean };

const readCookie = (name: string): string | null => {
  const m = document.cookie.split("; ").find((c) => c.startsWith(`${name}=`));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
};
const https = () => window.location.protocol === "https:";

/** Dark or light on every v2 wrapper and on <html> (the same as the theme button); "system" forgets the choice and follows the device. */
export function applyTheme(mode: "light" | "dark" | "system"): void {
  let resolved: "light" | "dark";
  if (mode === "system") {
    document.cookie = `${THEME_COOKIE}=; Max-Age=0; Path=/`;
    resolved = typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } else {
    document.cookie = serializePreference(THEME_COOKIE, mode, https());
    resolved = mode;
  }
  document.querySelectorAll('[data-ui="v2"]').forEach((el) => el.setAttribute("data-theme", resolved));
  document.documentElement.setAttribute("data-theme", resolved);
}

export function runClientAction(a: ClientAction, deps: RunDeps, hrefOf: (a: ClientAction, base: string) => string | null): Ran {
  switch (a.action) {
    case "theme": {
      const before = readCookie(THEME_COOKIE);
      applyTheme(a.mode);
      return { undo: () => applyTheme(before === "light" || before === "dark" ? before : "system"), back: false };
    }
    case "language": {
      const before = document.querySelector('[data-ui="v2"]')?.getAttribute("lang") ?? readCookie(LANG_COOKIE) ?? "en";
      const set = (lang: string) => {
        document.cookie = serializePreference(LANG_COOKIE, lang, https());
        deps.refresh();
      };
      set(a.lang);
      return { undo: () => set(before), back: false };
    }
    case "talk_live": {
      const onToday = deps.pathname.replace(/\/$/, "") === deps.base;
      const on = (v: boolean) => {
        if (v && !onToday) {
          deps.push(deps.base); // Talk live lives on Today
          setTimeout(() => deps.setTalking(true), 500);
        } else deps.setTalking(v);
      };
      on(a.state === "start");
      return { undo: () => on(a.state !== "start"), back: false };
    }
    default: {
      const href = hrefOf(a, deps.base);
      if (href) deps.push(href);
      return { undo: null, back: href !== null };
    }
  }
}
