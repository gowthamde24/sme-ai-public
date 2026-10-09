import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { V2Root, type V2Theme } from "@/components/v2/V2Root";
import { THEME_COOKIE, readTheme } from "@/i18n/preferences";

/**
 * The saved theme (cookie `sme_theme`), or undefined: no choice, or no request at all (a page test calls the page function directly, where `cookies()`
 * throws). Never throws.
 */
export async function currentTheme(): Promise<V2Theme | undefined> {
  try {
    return readTheme((await cookies()).get(THEME_COOKIE)?.value);
  } catch {
    return undefined;
  }
}

/**
 * The v2 island of a migrated screen, for a page that makes its own wrapper (a screen whose route has other, not yet migrated screens beside it cannot use a
 * folder layout). Synchronous, so a page can return it: the page reads `currentTheme()` itself. Its words are English until the language track, so it says lang=en.
 */
export function ScreenWrap({ theme, children }: { theme: V2Theme | undefined; children: ReactNode }) {
  return (
    <V2Root theme={theme} lang="en" className="min-h-[60dvh] bg-transparent bg-none">
      {children}
    </V2Root>
  );
}

/**
 * The same for a folder layout (workspace redesign, plan 2.9): reads the theme cookie like the frame does, so the screen follows the choice after a reload; the
 * theme button keeps every island in step without one.
 */
export async function ScreenIsland({ children }: { children: ReactNode }) {
  return <ScreenWrap theme={await currentTheme()}>{children}</ScreenWrap>;
}
