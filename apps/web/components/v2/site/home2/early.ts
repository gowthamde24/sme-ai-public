import type { SiteT } from "@/i18n/site";
import type { Lang } from "@/i18n/lang";
import { startEntry } from "@/lib/site/entry";
import { websiteOnly } from "@/lib/site/mode";
import { waitlistMode } from "@/lib/waitlist/mode";

/** The home page's "Get early access" (landing v2): its closing form (`#demo`) when the waitlist is on and the app is open; in website mode the site's "Book a demo"; without a form, where "start" leads today (lib/site/entry.ts). */
export function homeEarly(t: SiteT, lang: Lang): { href: string; label: string } {
  const form = waitlistMode() !== "off";
  if (!websiteOnly() && form) return { href: "#demo", label: t("h2.nav.early") };
  return startEntry(t, lang, t("nav.start"), { hasForm: form });
}
