import { ArrowRight, Check } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { LeakCalc, RadarFinder } from "@/components/v2/site/LazyIslands";
import { publicPlanLines } from "@/components/v2/site/PublicPlans";
import type { SiteKey, SiteT } from "@/i18n/site";
import { PUBLIC_PLANS, PLAN_FACTS, planVars, rupees, type PublicPlan } from "@/lib/site/plans";

import { Bento } from "./Bento";

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

/**
 * What comes under a plan: the same lines the pricing page words (its minutes, the extra-minute price, the Lead Finder searches, the set-up; lib/site/plans.ts and the pp.* strings, no number typed here) with "1 business number" after the minutes.
 */
function planLines(plan: PublicPlan, t: SiteT): string[] {
  const lines = publicPlanLines(plan, t);
  lines.splice(plan.minutes === null ? 1 : 2, 0, t("h4.pl.num"));
  return lines;
}

/** A plan on the home page: its name, its price a month and the ticked lines of what it includes (the pricing page has the rest); Pro, the recommended one, is outlined and carries its minutes bar (still). */
function PlanCard({ plan, t }: { plan: PublicPlan; t: SiteT }) {
  return (
    <li className="h4-slide">
      <div className={`h4-card h4-plan ${plan.recommended ? "h4-plan-rec" : ""}`} data-plan={plan.id}>
        <div className="h4-plan-top">
          <h3 className="h4-h3">{plan.name}</h3>
          {plan.recommended ? <span className="h4-rec">{t("pp.pop")}</span> : null}
        </div>
        <p className="h4-price" data-part="plan-cost">
          {rupees(plan.monthly)} <span>{t("pp.mo")}</span>
        </p>
        {plan.recommended ? (
          <span className="h4-minbar" aria-hidden="true">
            <span />
          </span>
        ) : null}
        <ul className="h4-plan-lines">
          {planLines(plan, t).map((line) => (
            <li key={line}>
              <Check size={16} strokeWidth={2.6} aria-hidden="true" />
              {line}
            </li>
          ))}
        </ul>
      </div>
    </li>
  );
}

/**
 * The sections of the home page between the try-it box and the FAQ (website-spec-v4): what late call-backs cost, the Lead Finder, the plans, and "Built in from day one" as a still bento (the voices are gone: the length rule). Designed at 390 px first
 * (design/home4.css). Each is a title of at most six words, one grey line and one visual. Every word comes from the string store; the page reads fully with JavaScript off (everything is server markup; only the radar's slow sweep moves).
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
        <ul className="h4-plans" data-part="plans">
          {PUBLIC_PLANS.map((p) => (
            <PlanCard key={p.id} plan={p} t={t} />
          ))}
        </ul>
        <p className="h4-every" data-part="every-plan">
          <b>{t("h4.pl.every")}</b> {[t("h4.pl.e1"), t("pp.sh.1"), t("h4.pl.e2"), t("pp.sh.2", planVars()), t("pp.sh.5"), t("pp.sh.3"), t("pp.sh.4")].join(" · ")}
        </p>
        <div className="h4-plans-note">
          <p data-part="plans-free">
            {t("h4.pl.line", { gst: `${PLAN_FACTS.gstPercent}%` })}{" "}
            <Link href="/pricing" className="h4-more-link" data-part="plans-more">
              {t("h4.pl.more")}
              <ArrowRight size={14} strokeWidth={2.4} aria-hidden="true" />
            </Link>
          </p>
        </div>
      </Section>
      <Section id="built" labelledBy="built-title">
        <Head id="built-title" title={t("h4.built.t")} />
        <Bento t={t} />
      </Section>
    </>
  );
}
