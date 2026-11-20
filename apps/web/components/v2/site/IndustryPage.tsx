import { ArrowRight, Sparkles } from "lucide-react";
import Link from "next/link";

import { JsonLd } from "@/components/v2/site/JsonLd";
import { homeEarly } from "@/components/v2/site/home2/early";
import { HomeFinal, PhoneDemo } from "@/components/v2/site/home/HomeMain";
import { PlansSection } from "@/components/v2/site/home/Lower";
import { StickyCta } from "@/components/v2/site/home/StickyCta";
import { hasWaitlist, type WaitlistAction } from "@/components/v2/site/WaitlistSection";
import { BRAND_NAME } from "@/design/brand";
import { teluguDemoFontVariable } from "@/design/fonts";
import type { SiteT } from "@/i18n/site";
import { siteTrialCopy } from "@/lib/screens/flag";
import { PUBLIC_URL } from "@/lib/seo/site";
import { startEntry } from "@/lib/site/entry";
import type { IndustryPageSpec } from "@/lib/site/industries";
import { websiteOnly } from "@/lib/site/mode";

/**
 * Industry SEO landing page (`/for/<industry>`), behind `INDUSTRY_PAGES=1` and English-only first: built from the existing home components
 * (hero one-liner for the industry, phone demo, 3 example jobs from packages/packs/<pack>/jobs.json, plans and final CTA).
 */
export function IndustryPage({ industry, t, waitlist }: { industry: IndustryPageSpec; t: SiteT; waitlist?: WaitlistAction }) {
  const hasForm = hasWaitlist(waitlist);
  const start = siteTrialCopy() ? startEntry(t, "en", t("h2.later.start"), { hasForm }) : homeEarly(t, "en");
  const cta = { href: start.href, label: t("h3.cta") };
  return (
    <>
      <div className={`h3 ${teluguDemoFontVariable}`} data-part="industry-page" data-industry={industry.slug}>
        <section id="top-hero" aria-labelledby="h1" className="h3-sec h3-hero">
          <div className="h3-wrap h3-hero-text">
            <p className="h3-eyebrow" data-part="industry-label">
              {industry.label}
            </p>
            <h1 id="h1" className="h3-h1">
              {industry.headline}
            </h1>
            <p className="h3-lead h3-hero-p">{industry.oneLiner}</p>
            <div className="h3-cta-row">
              <Link href={cta.href} className="h3-btn h3-btn-main h3-btn-block" data-part="hero-cta">
                {cta.label}
                <ArrowRight size={18} strokeWidth={2.2} aria-hidden="true" />
              </Link>
            </div>
            {websiteOnly() ? (
              <p className="h3-small" data-part="trial-note">
                {t("demo.note")}
              </p>
            ) : null}
          </div>
        </section>

        <PhoneDemo t={t} />

        <section id="example-jobs" aria-labelledby="jobs-title" className="h3-sec">
          <div className="h3-wrap">
            <header className="h3-head h3-head-center">
              <p className="h3-eyebrow">Example jobs</p>
              <h2 id="jobs-title" className="h3-h2">
                Ask your assistant in plain words.
              </h2>
            </header>
            <ul className="m-0 grid list-none gap-4 p-0 md:grid-cols-3" data-part="industry-jobs">
              {industry.jobs.map((job) => (
                <li key={job.id} className="h4-card flex flex-col justify-between gap-4 p-6" data-job={job.id}>
                  <div>
                    <h3 className="m-0 font-display text-xl font-bold leading-snug text-ink">{job.title}</h3>
                    <p className="m-0 mt-2 text-[15px] leading-relaxed text-muted">{job.benefit}</p>
                  </div>
                  <p className="m-0 inline-flex items-start gap-2 rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-[14.5px] font-medium leading-snug text-ink">
                    <Sparkles size={16} strokeWidth={2.2} aria-hidden="true" className="mt-0.5 shrink-0 text-brand-text" />
                    <span>&ldquo;{job.ask}&rdquo;</span>
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <PlansSection t={t} />
        <HomeFinal t={t} lang="en" cta={cta} hasForm={hasForm} waitlist={waitlist} />
        <StickyCta href={cta.href} label={cta.label} arrow={<ArrowRight size={18} strokeWidth={2.2} aria-hidden="true" />} />
      </div>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: `${BRAND_NAME} — ${industry.label}`,
          applicationCategory: "BusinessApplication",
          operatingSystem: "Web",
          url: `${PUBLIC_URL}/for/${industry.slug}`,
          description: industry.metaDescription,
          inLanguage: ["en-IN", "te-IN", "hi-IN", "kn-IN"],
        }}
      />
    </>
  );
}
