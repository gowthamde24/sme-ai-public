import type { ReactNode } from "react";

import "@/design/v2.css";
import { v2FontClassName } from "@/design/fonts";

export type V2Theme = "light" | "dark";

/**
 * The wrapper every design-v2 page opts into (ADR 0060). It carries the attribute that scopes the v2 tokens and reset,
 * the font variables, and (through the import above) the v2 stylesheet; a page that does not render it gets none of
 * this. `theme` is an explicit choice; without it the page follows the system colour scheme. `lang` is the language of the
 * content (the document's own `<html lang>` stays `en`: the root layout is not ours to change).
 */
export function V2Root({ children, theme, lang, className }: { children: ReactNode; theme?: V2Theme; lang?: string; className?: string }) {
  return (
    <div data-ui="v2" data-theme={theme} lang={lang} className={className ? `${v2FontClassName} ${className}` : v2FontClassName}>
      {children}
    </div>
  );
}
