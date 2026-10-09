import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { V2Root } from "@/components/v2/V2Root";
import { THEME_COOKIE, readTheme } from "@/i18n/preferences";

/**
 * The wrapper a migrated screen's folder layout uses: a v2 island for the screen's own content (plan 2.9). It reads the theme cookie like the
 * frame does, so the screen follows the choice after a reload (its words are English until the language track, so it says lang=en); the theme button keeps every island in step without one.
 */
export async function ScreenIsland({ children }: { children: ReactNode }) {
  const jar = await cookies();
  return (
    <V2Root theme={readTheme(jar.get(THEME_COOKIE)?.value)} lang="en" className="min-h-[60dvh] bg-transparent bg-none">
      {children}
    </V2Root>
  );
}
