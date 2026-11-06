import { JsonLd } from "@/components/v2/site/JsonLd";
import { HomeV2 } from "@/components/v2/site/home2/HomeV2";
import { hasWaitlist, type WaitlistAction } from "@/components/v2/site/WaitlistSection";
import { BRAND_NAME } from "@/design/brand";
import { fillPlain } from "@/i18n/fill";
import type { SiteT } from "@/i18n/site";
import type { Lang } from "@/i18n/lang";
import { PUBLIC_URL } from "@/lib/seo/site";
import { sitePath } from "@/lib/site/paths";

/**
 * The home page: landing v2 (job landing-v2; the owner approved the design on 6 Nov 2026), in components/v2/site/home2/HomeV2.tsx: the hero with its stage and Try it, the seven greetings, Hear a call, the Lead Finder radar,
 * the evening stand-up, the journey after the call, the business number, the leak, the plans, the questions and the closing form, then the footer with the dot wordmark (SiteFooter on the home page). Each moving scene is a lazy
 * island rendered on the server, so the page reads fully without script. Every word is a string of i18n/strings/site.json (`h2.*`).
 */
export function HomePage({ t, lang, waitlist }: { t: SiteT; lang: Lang; waitlist?: WaitlistAction }) {
  return (
    <>
      <HomeV2 t={t} lang={lang} hasForm={hasWaitlist(waitlist)} waitlist={waitlist} />
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
