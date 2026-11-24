import "@/design/v9.css";

import { JsonLd } from "@/components/v2/site/JsonLd";
import type { SiteT } from "@/i18n/site";
import { BRAND_NAME } from "@/design/brand";
import { PUBLIC_URL } from "@/lib/seo/site";
import { INDUSTRY_PRICING_LINE, type IndustryPageSpec } from "@/lib/site/industries";

import { V9Cta, V9Ftr, V9Hdr } from "./generated";

/**
 * An industry page (`/for/<industry>`, flag INDUSTRY_PAGES; English only): in the look of the home page (design/v9.css, every rule under `.v9`): the home page's header and footer, ONE honest headline and sentence with the
 * ONE call to action, three plain sections, a made-up example call (said so), the pricing line and the home page's closing card (the same action). No customer claims, no numbers that are not the plans'.
 * The in-page links of the header and footer go to the home page's sections.
 */
export function IndustryPage({ industry, t }: { industry: IndustryPageSpec; t: SiteT }) {
  const call = industry.call;
  return (
    <div className="v9 ind" data-part="industry-page" data-industry={industry.slug}>
      <V9Hdr t={t} home="/" />
      <main id="main">
        <section className="hero ind-hero" id="hero">
          <div className="wrap">
            <div className="hero-top">
              <div className="eyebrow-pill">
                <span data-part="industry-label">{industry.label}</span>
              </div>
              <h1>{industry.headline}</h1>
              <p className="hero-sub">{industry.sub}</p>
              <div className="hero-acts">
                <a href="#early-access" className="btn-primary" data-part="hero-cta">
                  {t("v9.hero.5")}
                </a>
              </div>
            </div>
          </div>
        </section>

        <section className="sec sec-white" aria-label={industry.label}>
          <div className="wrap">
            <ul className="ind-points" data-part="industry-sections">
              {industry.sections.map((s) => (
                <li key={s.title}>
                  <h2 className="ind-h">{s.title}</h2>
                  <p className="ind-p">{s.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="sec" aria-labelledby="ind-call-h">
          <div className="wrap">
            <div className="ind-call" data-part="sample-call">
              <h2 id="ind-call-h" className="ind-call-h">
                An example call
              </h2>
              <p className="ind-call-note">Made up for this page, in English. The assistant speaks the caller&rsquo;s language.</p>
              <ol className="ind-turns">
                {call.map((line, i) => (
                  <li key={i} data-who={i % 2 === 0 ? "caller" : "assistant"}>
                    <b>{i % 2 === 0 ? "Caller" : "Assistant"}</b>
                    <span>{line}</span>
                  </li>
                ))}
              </ol>
            </div>
            <p className="ind-price" data-part="pricing-line">
              {INDUSTRY_PRICING_LINE}
            </p>
          </div>
        </section>

        <V9Cta t={t} />
      </main>
      <V9Ftr t={t} lang="en" home="/" />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: `${BRAND_NAME}: ${industry.label}`,
          applicationCategory: "BusinessApplication",
          operatingSystem: "Web",
          url: `${PUBLIC_URL}/for/${industry.slug}`,
          description: industry.metaDescription,
          inLanguage: ["en-IN", "te-IN", "hi-IN", "kn-IN"],
        }}
      />
    </div>
  );
}
