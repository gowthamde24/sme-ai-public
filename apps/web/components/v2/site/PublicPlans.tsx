import { Check } from "lucide-react";
import Link from "next/link";

import { btnPrimary, btnSecondary, card } from "@/components/v2/site/ui";
import type { SiteKey, SiteT } from "@/i18n/site";
import { extraLines } from "@/lib/screens/flag";
import { PUBLIC_PLANS, planVars, rupees, type PublicPlan } from "@/lib/site/plans";

const TAG: Record<PublicPlan["id"], SiteKey> = { payg: "pp.payg.t", pro: "pp.pro.t", business: "pp.biz.t" };
const SHARED = [1, 2, 3, 4, 5, 6, 9] as const;

/**
 * The lines of one paid plan (what it includes that the others do not share): its minutes, the extra-minute price, Find customers searches and the set-up. Every number is the plan's own (lib/site/plans.ts), never typed in a
 * string. Pure.
 */
export function publicPlanLines(plan: PublicPlan, t: SiteT): string[] {
  const v = planVars();
  const lines: string[] = [];
  lines.push(plan.minutes === null ? t("pp.perminute", v) : t("pp.included", { n: new Intl.NumberFormat("en-IN").format(plan.minutes) }));
  if (plan.minutes !== null) lines.push(t("pp.extra", v));
  lines.push(plan.minutes === null ? t("pp.find.payg", { free: plan.find.included, p: plan.find.then }) : t("pp.find.n", { n: plan.find.included, p: plan.find.then }));
  lines.push(t(plan.setup === "priority" ? "pp.setup.prio" : "pp.setup.self"));
  return lines;
}

/**
 * The three paid plans for the pricing page: Pay as you go, Pro (recommended) and Business, each with its monthly price and "+ 18% GST", what it includes and one button; then what every plan includes and where the plans
 * cross. Everything here is for the paid plans (from February 2027): early access is free and the button says so. Server markup only (no script).
 */
export function PublicPlanCards({ t, start }: { t: SiteT; start: { href: string; label: string } }) {
  const v = planVars();
  return (
    <div data-plan-group="paid">
      <ul className="grid gap-4 md:grid-cols-3" data-part="plans" data-plan-kind="paid">
        {PUBLIC_PLANS.map((p) => (
          <li key={p.id} className={`${card} flex flex-col ${p.recommended ? "border-brand-text ring-1 ring-brand-text" : ""}`} data-plan={p.id}>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-xl font-semibold">{p.name}</h3>
              {p.recommended ? (
                <span className="inline-flex items-center rounded-md bg-brand px-2.5 py-0.5 text-sm font-semibold text-on-brand" data-part="recommended">
                  {t("pp.pop")}
                </span>
              ) : null}
            </div>
            <p className="mt-2 text-base text-muted md:min-h-[3.5rem]">{t(TAG[p.id])}</p>
            <p className="mt-4 flex items-baseline gap-2 font-display" data-part="plan-price">
              <span className="text-4xl font-extrabold tracking-tight">{rupees(p.monthly)}</span>
              <span className="text-base text-muted">{t("pp.mo")}</span>
            </p>
            <p className="text-sm text-muted">{t("pp.gst")}</p>
            <ul className="mt-4 flex flex-1 flex-col gap-2 text-base">
              {publicPlanLines(p, t).map((line) => (
                <li key={line} className="flex items-start gap-2">
                  <Check className="mt-1 size-4 shrink-0 text-green-text" aria-hidden="true" />
                  {line}
                </li>
              ))}
            </ul>
            <Link href={start.href} className={`${p.recommended ? btnPrimary : btnSecondary} mt-5 w-full`}>
              {start.label}
            </Link>
            <p className="mt-2 text-center text-sm text-muted">{t("pp.cta.note")}</p>
          </li>
        ))}
      </ul>
      <section aria-labelledby="every-plan" className="mt-5 rounded-xl border border-line bg-surface-2 p-5" data-part="every-plan">
        <h3 id="every-plan" className="text-sm font-semibold uppercase tracking-wide text-muted">
          {t("pp.every.h")}
        </h3>
        <ul className="mt-3 grid gap-2 text-base md:grid-cols-2 md:gap-x-8">
          {SHARED.map((n) => (
            <li key={n} className="flex items-start gap-2">
              <Check className="mt-1 size-4 shrink-0 text-green-text" aria-hidden="true" />
              {t(`pp.sh.${n}` as const, v)}
            </li>
          ))}
          {extraLines() !== "off" ? (
            <li data-part="extra-lines-row" className="flex items-start gap-2">
              <Check className="mt-1 size-4 shrink-0 text-green-text" aria-hidden="true" />
              {t("pp.sh.lines", v)}
            </li>
          ) : null}
        </ul>
      </section>
      <p className="mt-4 max-w-3xl text-sm text-muted">{t("pp.hint", v)}</p>
    </div>
  );
}

/** The compact version for the home page's plans slab: the plan's name, price, GST and its lines in one column (no shared list). */
export function PublicPlanColumn({ plan, t, start }: { plan: PublicPlan; t: SiteT; start: { href: string; label: string } }) {
  return (
    <div className={`flex flex-col gap-[18px] p-6 lg:px-9 lg:py-10`} data-plan={plan.id}>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="m-0 font-display text-[26px] font-extrabold tracking-[-0.03em] lg:text-[30px]">{plan.name}</h3>
          {plan.recommended ? <span className="inline-flex items-center rounded-md bg-[#c2410c] px-2.5 py-0.5 text-sm font-bold text-white">{t("pp.pop")}</span> : null}
        </div>
        <p className="m-0 mt-2 font-display text-[34px] font-extrabold leading-none tracking-[-0.03em]" data-part="plan-cost">
          {rupees(plan.monthly)} <span className="text-base font-medium tracking-normal text-muted">{t("pp.mo")}</span>
        </p>
        <p className="m-0 mt-1 text-sm text-muted">{t("pp.gst")}</p>
      </div>
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0 text-base">
        {publicPlanLines(plan, t).map((line) => (
          <li key={line} className="flex items-start gap-2.5">
            <Check className="mt-1 size-4 shrink-0 text-brand-text" aria-hidden="true" />
            {line}
          </li>
        ))}
      </ul>
      <div className="mt-auto flex flex-col gap-2">
        <Link href={start.href} className={plan.recommended ? "inline-flex min-h-12 items-center justify-center rounded-md bg-[#c2410c] px-6 font-extrabold text-white shadow-[0_10px_24px_-10px_rgba(194,65,12,.8)]" : "inline-flex min-h-12 items-center justify-center rounded-md bg-surface px-6 font-bold shadow-[inset_0_0_0_1.5px_var(--v2-border)]"}>
          {start.label}
        </Link>
        <p className="m-0 text-center text-sm text-muted">{t("pp.cta.note")}</p>
      </div>
    </div>
  );
}

