import { JsonLd } from "@/components/v2/site/JsonLd";
import { CloseBand, DaySection, FaqBand, HomeHero, IndustriesSection, LeadDeskRows, PlansBand, PromisesBand, SourcesBand } from "@/components/v2/site/HomeSections";
import { hasWaitlist, WaitlistSection, type WaitlistAction } from "@/components/v2/site/WaitlistSection";
import { BRAND_NAME } from "@/design/brand";
import { fillPlain } from "@/i18n/fill";
import type { SiteT } from "@/i18n/site";
import type { Lang } from "@/i18n/lang";
import { PUBLIC_URL } from "@/lib/seo/site";
import { sitePath } from "@/lib/site/paths";

/**
 * The home page (job DM; Lead Desk in night 4; redone as "landing v3" in night 5, after the approved landing reference): the hero (the headline in three lines, one button to start and one to a day with the product,
 * the assistant's wave orb over an example call), the places leads come from (found for you, and the ones you already get), "a day with {brand}", Lead Desk in five rows, the three industries with their own pages and the other businesses, two ways to
 * start, four promises, the questions owners ask, the "book a demo" form where the site has one, and a closing band. Every word is a string of i18n/strings/site.json (`v3.*`, and the existing ones for the plans and chips) or a field of a
 * business type's landing.json; the example call lives in lib/site/home-v3.ts. The only client code is the call card, which stands still with "reduce motion"; every section is server markup and nothing else moves (no fade-in on scroll, no
 * marquee, no play or pause button).
 */
export function HomePage({ t, lang, waitlist }: { t: SiteT; lang: Lang; waitlist?: WaitlistAction }) {
  return (
    <>
      <HomeHero t={t} lang={lang} hasForm={hasWaitlist(waitlist)} />
      <SourcesBand t={t} />
      <DaySection t={t} />
      <LeadDeskRows t={t} />
      <IndustriesSection t={t} lang={lang} />
      <PlansBand t={t} />
      <PromisesBand t={t} />
      <FaqBand t={t} />
      <WaitlistSection t={t} lang={lang} action={waitlist} />
      <CloseBand t={t} lang={lang} />
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
