import { CircleHelp, CreditCard, LogIn, Menu, MessageSquare, Radar, X } from "lucide-react";
import Link from "next/link";

import { SiteLangSelect } from "@/components/v2/controls/SiteLangSelect";
import { ThemeButton } from "@/components/v2/controls/ThemeButton";
import { HeaderSheet } from "@/components/v2/site/HeaderSheet";
import { container } from "@/components/v2/site/ui";
import { Wordmark } from "@/components/v2/Wordmark";
import { BRAND_NAME } from "@/design/brand";
import type { SiteT } from "@/i18n/site";
import { type SiteLang } from "@/i18n/lang";
import { SITE_LANGS } from "@/i18n/site-lang";
import type { Theme } from "@/i18n/preferences";
import { startEntry } from "@/lib/site/entry";
import { loginHref } from "@/lib/site/login-url";
import { websiteOnly } from "@/lib/site/mode";
import { sitePath, type SiteTarget } from "@/lib/site/paths";
import { waitlistMode } from "@/lib/waitlist/mode";

/** The menu sheet's icons, drawn here on the server (How it works, Lead Finder, Pricing, FAQ). */
const NAV_ICONS = [MessageSquare, Radar, CreditCard, CircleHelp].map((I, i) => <I key={i} size={20} strokeWidth={2.1} aria-hidden="true" />);

const link = "inline-flex min-h-11 items-center whitespace-nowrap rounded-lg px-3 text-[15px] font-semibold text-ink hover:bg-surface-2";

/**
 * The header of every public page (jobs CM, CX, DM; the three-bar logo and five links in night 5): the logo and the name, five links (How it works, Lead Desk, Industries, Pricing, Questions: the sections of the home page, so from another page they lead back to it; Pricing leads
 * to the plans page there), Sign in, the language (this page in the other languages), the theme, and the one button of the site, "Start trial". From 900 px (the width of a phone with "Desktop site" switched on is about 980) the links sit in the bar; below that they are a native
 * disclosure (`<details>`, no script); the button stays in the bar, and the language and theme stay there from 640 px (below that they are in the menu).
 */
export function SiteHeader({ t, lang, theme, target }: { t: SiteT; lang: SiteLang; theme?: Theme; target: SiteTarget }) {
  const hrefs = Object.fromEntries(SITE_LANGS.map((l) => [l, sitePath(l, target)])) as Record<SiteLang, string>;
  const home = sitePath(lang, { kind: "home" });
  const onHome = target.kind === "home";
  const base = onHome ? "" : home;
  const pricingPage = sitePath(lang, { kind: "page", page: "pricing" });
  // website mode (job DQ): the app is closed, so there is no sign-in and the one button is "Join early access" (to the form on the pages that have it)
  const web = websiteOnly();
  const start = startEntry(t, lang, t("nav.start"), { hasForm: waitlistMode() !== "off" && (target.kind !== "page" || target.page === "contact") });
  // landing v2: four parts of the home page (owner, 6 Nov 2026: fewer links in the bar; the Lead Finder and the business number are in the footer); from another page they lead back to it
  const nav = [
    { href: `${base}#how-it-works`, label: t("nav.how"), here: false },
    { href: `${base}#lead-finder`, label: t("h2.nav.finder"), here: false },
    { href: onHome ? "#pricing" : pricingPage, label: t("nav.pricing"), here: target.kind === "page" && target.page === "pricing" },
    { href: `${base}#faq`, label: t("h4.nav.faq"), here: false },
    { href: sitePath(lang, { kind: "page", page: "help" }), label: t("nav.help"), here: target.kind === "article" || (target.kind === "page" && target.page === "help") },
  ];
  // "Get early access": the home page's closing form; on a page without the form, where "start" leads today
  // (website mode and the app-open home page both say "Join early access": one call to action, owner 11 Nov 2026)
  const early = !web && onHome && waitlistMode() !== "off" ? { href: "#demo", label: t("h2.nav.early"), short: t("h2.nav.early.short") } : { href: start.href, label: start.label, short: web && lang !== "en" ? t("h2.nav.early.short") : start.label }; // (website mode: the one button reads "Early access" below 1280 px in te, hi, kn and ta: the full words push the menu button off a 360 to 430 px screen)
  return (
    <header className="[position:sticky] top-0 z-30 border-b border-line bg-bg/[0.86] backdrop-blur-lg backdrop-saturate-150">
      {/* the scroll's progress, a thin line under the bar (drawn by the scroll where the browser can; none where it cannot) */}
      <span aria-hidden="true" className="h2-prog" />
      <div className={`${container} flex min-h-16 items-center gap-2 py-2 sm:gap-3`}>
        {/* under 360 px the name is a size smaller, so the bar still fits with large text (Android 115%) */}
        <Link href={home} className="inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-md [&_.font-display]:text-[19px] min-[900px]:[&_.font-display]:text-2xl" aria-label={BRAND_NAME}>
          <Wordmark />
        </Link>
        <nav aria-label={t("nav.sections")} className="ml-4 hidden items-center gap-1 min-[900px]:flex">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} aria-current={n.here ? "page" : undefined} className={`${link} ${n.here ? "bg-surface-2 font-semibold" : ""}`}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <a href={loginHref()} className="hidden min-h-11 min-w-11 shrink-0 items-center justify-center whitespace-nowrap rounded-full border border-line px-4 text-[15px] font-bold text-ink hover:bg-surface-2 md:inline-flex">
            {t("h2.nav.login")}
          </a>
          {/* a phone keeps the one button in the bar (the landing v2 phone design) and finds the language and the theme in the menu */}
          <span className="hidden items-center gap-2 sm:flex">
            <SiteLangSelect lang={lang} label={t("lang.label")} hrefs={hrefs} langs={SITE_LANGS} />
            <ThemeButton initial={theme} toDark={t("theme.toDark")} toLight={t("theme.toLight")} />
          </span>
          <Link href={early.href} className="inline-flex min-h-11 items-center whitespace-nowrap rounded-full bg-[#c2410c] px-4 text-[15px] font-bold text-white sm:px-[18px]">
            <span className="xl:hidden">{early.short}</span>
            <span className="max-xl:hidden">{early.label}</span>
          </Link>
          <HeaderSheet
            label={t("nav.menu")}
            closeLabel={t("h3.menu.close")}
            items={nav.map((n, i) => ({ href: n.href, label: n.label, here: n.here, icon: NAV_ICONS[i] ?? NAV_ICONS[3] }))}
            login={{ href: loginHref(), label: t("h2.nav.login") }}
            cta={{ href: early.href, label: t("h3.menu.cta") }}
            icons={{ menu: <Menu className="size-5" aria-hidden="true" />, close: <X className="size-5" aria-hidden="true" />, login: <LogIn size={20} strokeWidth={2.1} aria-hidden="true" /> }}
          >
            <SiteLangSelect lang={lang} label={t("lang.label")} hrefs={hrefs} langs={SITE_LANGS} />
            <ThemeButton initial={theme} toDark={t("theme.toDark")} toLight={t("theme.toLight")} />
          </HeaderSheet>
        </div>
      </div>
    </header>
  );
}
