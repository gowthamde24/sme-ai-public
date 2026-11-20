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
export function V2Root({ children, theme, lang, className, ds = false, jobs = false, site = false }: { children: ReactNode; theme?: V2Theme; lang?: string; className?: string; /** The public site: one sans face for everything (no display face is named). */ site?: boolean; /** Design system v6 (DESIGN_V6): the new tokens, background and status colours of design/ds.css. */ ds?: boolean; /** JOBS (decision-ai-team, 19 Nov): the one design system of design/jobs.css: round ticks, solid status chips, the branded loading. */ jobs?: boolean }) {
  // The workspace (ds) always carries all three Indic fonts: a Telugu spoken line or plan sentence can sit in an English app, and the browser downloads a font only when a letter of its script is shown (unicode-range).
  const fonts = v2FontClassName(ds ? undefined : lang, site);
  return (
    <div data-ui="v2" data-theme={theme} {...(ds ? { "data-ds": "6" } : {})} {...(ds && jobs ? { "data-jobs": "1" } : {})} lang={lang} className={className ? `${fonts} ${className}` : fonts}>
      {children}
    </div>
  );
}
