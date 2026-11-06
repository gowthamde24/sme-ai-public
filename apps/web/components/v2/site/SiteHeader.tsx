import { Menu } from "lucide-react";
import Link from "next/link";

import { LangSelect } from "@/components/v2/controls/LangSelect";
import { ThemeButton } from "@/components/v2/controls/ThemeButton";
import { container } from "@/components/v2/site/ui";
import { Wordmark } from "@/components/v2/Wordmark";
import { BRAND_NAME } from "@/design/brand";
import type { SiteT } from "@/i18n/site";
import { LANGS, type Lang } from "@/i18n/lang";
import type { Theme } from "@/i18n/preferences";
import { startEntry } from "@/lib/site/entry";
import { websiteOnly } from "@/lib/site/mode";
import { sitePath, type SiteTarget } from "@/lib/site/paths";
import { waitlistMode } from "@/lib/waitlist/mode";

const link = "inline-flex min-h-11 items-center whitespace-nowrap rounded-lg px-3 text-[15px] font-semibold text-ink hover:bg-surface-2";

/**
 * The header of every public page (jobs CM, CX, DM; the three-bar logo and five links in night 5): the logo and the name, five links (How it works, Lead Desk, Industries, Pricing, Questions: the sections of the home page, so from another page they lead back to it; Pricing leads
 * to the plans page there), Sign in, the language (this page in the other languages), the theme, and the one button of the site, "Start trial". From 1024 px the links sit in the bar; below that they are a native
 * disclosure (`<details>`, no script); the button stays in the bar, and the language and theme stay there from 640 px (below that they are in the menu).
 */
export function SiteHeader({ t, lang, theme, target }: { t: SiteT; lang: Lang; theme?: Theme; target: SiteTarget }) {
  const hrefs = Object.fromEntries(LANGS.map((l) => [l, sitePath(l, target)])) as Record<Lang, string>;
  const home = sitePath(lang, { kind: "home" });
  const onHome = target.kind === "home";
  const base = onHome ? "" : home;
  const pricingPage = sitePath(lang, { kind: "page", page: "pricing" });
  // website mode (job DQ): the app is closed, so there is no sign-in and the one button is "Book a demo" (to the form on the pages that have it)
  const web = websiteOnly();
  const start = startEntry(t, lang, t("nav.start"), { hasForm: waitlistMode() !== "off" && (target.kind !== "page" || target.page === "contact") });
  // landing v2 (owner approved 6 Nov 2026): the six parts of the home page; from another page they lead back to it
  const nav = [
    { href: `${base}#call`, label: t("h2.nav.call"), here: false },
    { href: `${base}#finder`, label: t("h2.nav.finder"), here: false },
    { href: `${base}#team`, label: t("h2.nav.team"), here: false },
    { href: `${base}#number`, label: t("h2.nav.number"), here: false },
    { href: onHome ? "#plans" : pricingPage, label: t("h2.nav.plans"), here: target.kind === "page" && target.page === "pricing" },
    { href: `${base}#faq`, label: t("h2.nav.faq"), here: false },
  ];
  // "Get early access": the home page's closing form; on a page without the form, where "start" leads today
  // (website mode keeps its "Book a demo"; with the app open, the home page's form is "Get early access")
  const early = !web && onHome && waitlistMode() !== "off" ? { href: "#demo", label: t("h2.nav.early"), short: t("h2.nav.early.short") } : { href: start.href, label: start.label, short: start.label };
  return (
    <header className="[position:sticky] top-0 z-30 border-b border-line bg-bg/[0.86] backdrop-blur-lg backdrop-saturate-150">
      {/* the scroll's progress, a thin line under the bar (drawn by the scroll where the browser can; none where it cannot) */}
      <span aria-hidden="true" className="h2-prog" />
      <div className={`${container} flex min-h-16 items-center gap-2 py-2 sm:gap-3`}>
        <Link href={home} className="shrink-0 whitespace-nowrap rounded-md" aria-label={BRAND_NAME}>
          <Wordmark />
        </Link>
        <nav aria-label={t("nav.sections")} className="ml-4 hidden items-center gap-1 lg:flex">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} aria-current={n.here ? "page" : undefined} className={`${link} ${n.here ? "bg-surface-2 font-semibold" : ""}`}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          {web ? null : (
            <Link href="/login" className="hidden min-h-11 min-w-11 shrink-0 items-center justify-center whitespace-nowrap rounded-lg px-3 text-[15px] font-bold text-ink hover:bg-surface-2 md:inline-flex">
              {t("h2.nav.login")}
            </Link>
          )}
          {/* a phone keeps the one button in the bar (the landing v2 phone design) and finds the language and the theme in the menu */}
          <span className="hidden items-center gap-2 sm:flex">
            <LangSelect lang={lang} label={t("lang.label")} hrefs={hrefs} />
            <ThemeButton initial={theme} toDark={t("theme.toDark")} toLight={t("theme.toLight")} />
          </span>
          <Link href={early.href} className="inline-flex min-h-11 items-center whitespace-nowrap rounded-full bg-ink px-3.5 text-sm font-bold text-bg sm:px-[18px] sm:text-[15px]">
            <span className="xl:hidden">{early.short}</span>
            <span className="max-xl:hidden">{early.label}</span>
          </Link>
          <details className="group relative lg:hidden">
            <summary className="inline-flex min-h-11 min-w-11 cursor-pointer list-none items-center justify-center rounded-lg border border-edge bg-surface text-ink hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
              <Menu className="size-5" aria-hidden="true" />
              <span className="sr-only">{t("nav.menu")}</span>
            </summary>
            <nav aria-label={t("nav.sections")} className="absolute right-0 top-full mt-2 w-64 rounded-xl border border-line bg-surface p-2 shadow-[var(--v2-shadow-pop)]">
              <ul className="flex flex-col">
                {nav.map((n) => (
                  <li key={n.href}>
                    <Link href={n.href} aria-current={n.here ? "page" : undefined} className={`${link} w-full ${n.here ? "bg-surface-2 font-semibold" : ""}`}>
                      {n.label}
                    </Link>
                  </li>
                ))}
                {web ? null : (
                  <li>
                    <Link href="/login" className={`${link} w-full text-brand-text`}>
                      {t("h2.nav.login")}
                    </Link>
                  </li>
                )}
                <li className="mt-1 flex items-center gap-2 border-t border-line px-1 pt-2 sm:hidden">
                  <LangSelect lang={lang} label={t("lang.label")} hrefs={hrefs} />
                  <ThemeButton initial={theme} toDark={t("theme.toDark")} toLight={t("theme.toLight")} />
                </li>
              </ul>
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}
