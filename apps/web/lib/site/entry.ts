import type { Lang } from "@/i18n/lang";
import type { SiteT } from "@/i18n/site";

import { siteMode, type SiteMode } from "./mode";
import { sitePath } from "./paths";

/**
 * Where the "start the trial" buttons of the public pages lead (job DQ). Normally to sign-up with the button's own words. In website mode the app is closed, so every one of them is "Book a demo" and goes to the form: on the
 * page that has the form (home, a business type, contact) to its anchor, from any other page to the contact page's. Pure.
 */
export function startEntry(t: SiteT, lang: Lang, label: string, opts: { hasForm?: boolean; mode?: SiteMode } = {}): { href: string; label: string } {
  if ((opts.mode ?? siteMode()) !== "website") return { href: "/signup", label };
  return { href: opts.hasForm ? "#demo" : `${sitePath(lang, { kind: "page", page: "contact" })}#demo`, label: t("demo.cta") };
}
