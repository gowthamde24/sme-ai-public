import { Orb } from "@/components/v2/Orb";
import { SiteShell } from "@/components/v2/site/SiteShell";
import { WaitlistSection, type WaitlistAction } from "@/components/v2/site/WaitlistSection";
import { container, lead } from "@/components/v2/site/ui";
import { siteT } from "@/i18n/site";
import type { Lang } from "@/i18n/lang";
import type { Theme } from "@/i18n/preferences";

/**
 * "Opening soon — book a demo" (job DQ): what the app, sign-in and sign-up show while the site is in website mode (SITE_MODE=website; proxy.ts rewrites those addresses here). The public site's frame, one headline, one line, and the same
 * "Book a demo" form as the home page. Pure: the route reads the language and theme cookies and passes them in.
 */
export function OpeningSoon({ lang, theme, waitlist }: { lang: Lang; theme?: Theme; waitlist?: WaitlistAction }) {
  const t = siteT(lang);
  return (
    <SiteShell lang={lang} theme={theme} t={t} target={{ kind: "home" }}>
      <section aria-labelledby="h1" className={`${container} flex flex-col items-start gap-5 pb-6 pt-10 sm:pt-16`} data-part="opening-soon">
        <Orb px={64} state="think" halo />
        <h1 id="h1" className="max-w-3xl font-display text-3xl font-bold leading-hero tracking-tight sm:text-5xl">
          {t("soon.title")}
        </h1>
        <p className={lead}>{t("soon.sub")}</p>
      </section>
      <WaitlistSection t={t} lang={lang} action={waitlist} />
    </SiteShell>
  );
}
