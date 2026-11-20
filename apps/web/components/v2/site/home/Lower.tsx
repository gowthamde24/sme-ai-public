import { ArrowRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { LeakCalc, RadarFinder } from "@/components/v2/site/LazyIslands";
import type { SiteKey, SiteT } from "@/i18n/site";
import { PUBLIC_PLANS, PLAN_FACTS, rupees, type PublicPlan } from "@/lib/site/plans";

import { Swipe } from "./Swipe";
import { TrustRow } from "./TrustRow";

type Start = { href: string; label: string };
const k = (s: string) => s as SiteKey;
/** The words a client island needs, filled on the server (the site's dictionaries never reach the browser whole). */
const words = (t: SiteT, keys: readonly string[]): Record<string, string> => Object.fromEntries(keys.map((key) => [key, t(k(key))]));
const FINDER_KEYS = [...["city", "call", "ask"].map((x) => `h2.finder.${x}`), "h4.eg", ...[1, 4].map((i) => `h2.finder.pin.${i}.what`)];
const LEAK_KEYS = [...["enq", "miss", "buy", "avg", "in"].map((x) => `h2.leak.${x}`), ...["warm", "cold", "note"].map((x) => `h3.leak.${x}`), "h4.leak.slip", "h4.leak.with", "h4.leak.more"];

/** A section's title block (the spec's: a title of at most six words, then one grey line). */
function Head({ id, title, sub }: { id: string; title: string; sub?: string }) {
  return (
    <header className="h4-head">
      <h2 id={id} className="h4-h2">
        {title}
      </h2>
      {sub ? <p className="h4-lead">{sub}</p> : null}
    </header>
  );
}

function Section({ id, labelledBy, children }: { id: string; labelledBy: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={labelledBy} className="h4" data-part={`h4-${id}`}>
      <div className="h4-wrap">{children}</div>
    </section>
  );
}

/** A plan on the home page: its name, its price a month, and ONE line (its minutes; for Pay as you go, the price of a minute). Every number is the plan's own (lib/site/plans.ts); the pricing page has the rest. */
function PlanCard({ plan, t }: { plan: PublicPlan; t: SiteT }) {
  const line = plan.minutes === null ? t("h4.pl.payg", { p: rupees(PLAN_FACTS.extraMinute) }) : t("h4.pl.min", { n: new Intl.NumberFormat("en-IN").format(plan.minutes) });
  return (
    <div className={`h4-card h4-plan ${plan.recommended ? "h4-plan-rec" : ""}`} data-plan={plan.id}>
      <div className="h4-plan-top">
        <h3 className="h4-h3">{plan.name}</h3>
        {plan.recommended ? <span className="h4-rec">{t("pp.pop")}</span> : null}
      </div>
      <p className="h4-price" data-part="plan-cost">
        {rupees(plan.monthly)} <span>{t("pp.mo")}</span>
      </p>
      <p className="h4-card-d">{line}</p>
      {plan.recommended ? (
        <span className="h4-minbar" aria-hidden="true">
          <span />
        </span>
      ) : null}
    </div>
  );
}

/**
 * The sections of the home page between the try-it box and the FAQ (website-spec-v4): what late call-backs cost, the Lead Finder, and the plans with ONE trust row under them (the voices and the built-in section are gone: the length rule). Designed at 390 px first
 * (design/home4.css). Each is a title of at most six words, one grey line and one visual. Every word comes from the string store; the page reads fully with JavaScript off (the swipe rows are plain scrolling lists, the transcripts and the plans are server markup).
 */
export function LowerSections({ t }: { t: SiteT; cta?: Start }) {
  return (
    <>
      <Section id="calc" labelledBy="calc-title">
        <Head id="calc-title" title={t("h4.leak.t")} sub={t("h4.leak.sub")} />
        <LeakCalc w={words(t, LEAK_KEYS)} />
      </Section>
      <Section id="lead-finder" labelledBy="finder-title">
        <Head id="finder-title" title={t("h4.finder.t")} sub={t("h4.finder.sub")} />
        <RadarFinder w={words(t, FINDER_KEYS)} />
      </Section>
      <Section id="pricing" labelledBy="plans-title">
        <Head id="plans-title" title={t("h4.pl.title")} />
        <Swipe label={t("h4.pl.title")} dotWord={t("h4.dot")} className="h4-plans">
          {PUBLIC_PLANS.map((p) => (
            <PlanCard key={p.id} plan={p} t={t} />
          ))}
        </Swipe>
        <div className="h4-plans-note">
          <p data-part="plans-free">
            {t("h4.pl.line", { gst: `${PLAN_FACTS.gstPercent}%` })}{" "}
            <Link href="/pricing" className="h4-more-link" data-part="plans-more">
              {t("h4.pl.more")}
              <ArrowRight size={14} strokeWidth={2.4} aria-hidden="true" />
            </Link>
          </p>
        </div>
        <TrustRow w={{ t1: t("h4.tr.1"), t2: t("h4.tr.2"), t3: t("h4.tr.3"), t4: t("h4.tr.4"), kyc: t("h4.m.kyc"), yes: t("h4.m.yes"), added: t("h4.m.added"), done: t("h4.m.done"), wait: t("h4.m.wait") }} />
      </Section>
    </>
  );
}
