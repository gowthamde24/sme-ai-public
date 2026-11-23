import { JsonLd } from "@/components/v2/site/JsonLd";
import { V9Home } from "@/components/v2/site/v9/V9Home";
import type { WaitlistAction } from "@/components/v2/site/WaitlistSection";
import { BRAND_NAME } from "@/design/brand";
import { fillPlain } from "@/i18n/fill";
import type { SiteT } from "@/i18n/site";
import type { SiteLang } from "@/i18n/lang";
import { PUBLIC_URL } from "@/lib/seo/site";
import { sitePath } from "@/lib/site/paths";

/**
 * The home page (19 Nov 2026, owner: "we don't need to mention each and every business"; one page for every width): components/v2/site/home/HomeMain.tsx, then the home footer. Every word is a string of i18n/strings/site.json (`h3.*`, `pp.*`, `h2.plans.*`, `h2.join.*`).
 */
export function HomePage({ t, lang, waitlist }: { t: SiteT; lang: SiteLang; waitlist?: WaitlistAction }) {
  return (
    <>
      <V9Home t={t} lang={lang} />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: BRAND_NAME,
          applicationCategory: "BusinessApplication",
          operatingSystem: "Web",
          url: PUBLIC_URL + sitePath(lang, { kind: "home" }),
          description: fillPlain(t("meta.description")),
          // the product speaks these four; Tamil is a language of this website only (it is not listed here, so no search engine reads it as a product language)
          inLanguage: ["en-IN", "te-IN", "hi-IN", "kn-IN"],
        }}
      />
    </>
  );
}
