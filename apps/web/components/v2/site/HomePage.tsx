import { JsonLd } from "@/components/v2/site/JsonLd";
import { homeEarly } from "@/components/v2/site/home2/early";
import { HomeMain } from "@/components/v2/site/home/HomeMain";
import { hasWaitlist, type WaitlistAction } from "@/components/v2/site/WaitlistSection";
import { BRAND_NAME } from "@/design/brand";
import { fillPlain } from "@/i18n/fill";
import type { SiteT } from "@/i18n/site";
import type { Lang } from "@/i18n/lang";
import { PUBLIC_URL } from "@/lib/seo/site";
import { startEntry } from "@/lib/site/entry";
import { siteTrialCopy } from "@/lib/screens/flag";
import { sitePath } from "@/lib/site/paths";

/**
 * The home page (19 Nov 2026, owner: "we don't need to mention each and every business"; one page for every width): components/v2/site/home/HomeMain.tsx, then the home footer. Every word is a string of i18n/strings/site.json (`h3.*`, `pp.*`, `h2.plans.*`, `h2.join.*`).
 */
export function HomePage({ t, lang, waitlist }: { t: SiteT; lang: Lang; waitlist?: WaitlistAction }) {
  // where the page's buttons lead: the closing early-access form (`#demo`), or sign-up (website mode and the trial copy say so in lib/site/entry.ts)
  const start = siteTrialCopy() ? startEntry(t, lang, t("h2.later.start"), { hasForm: hasWaitlist(waitlist) }) : homeEarly(t, lang);
  return (
    <>
      <HomeMain t={t} lang={lang} start={start} hasForm={hasWaitlist(waitlist)} waitlist={waitlist} />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: BRAND_NAME,
          applicationCategory: "BusinessApplication",
          operatingSystem: "Web",
          url: PUBLIC_URL + sitePath(lang, { kind: "home" }),
          description: fillPlain(t("meta.description")),
          inLanguage: ["en-IN", "te-IN", "hi-IN", "kn-IN"],
        }}
      />
    </>
  );
}
