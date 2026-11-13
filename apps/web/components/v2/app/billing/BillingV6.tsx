import Link from "next/link";
import type { ReactNode } from "react";

import type { BillingBalance } from "@/lib/billing-v6/balance";
import { gstInside, type Invoice } from "@/lib/billing-v6/invoices";
import type { PricePlan, Pricing } from "@/lib/billing-v6/pricing";
import { formatRupeesShort } from "@/lib/money";

import { PageHeader } from "../ds/PageHeader";
import { btnQuiet, pageMain } from "../ui";
import { Meter } from "../v6/Meter";
import { card, cardQuiet, sectionTitle } from "../v6/ui";
import { makeT, type Words } from "../words";

import { FreeStartButton } from "./FreeStartButton";
import { TopupSheet } from "./TopupSheet";

type Result = { ok: true } | { ok: false; error: string };
export type BillingV6Props = {
  words: Words;
  lang: string;
  base: string;
  /** helpTipFor(lang, base, "billing", true) */
  help: ReactNode;
  /** null = billing could not be read. */
  balance: BillingBalance | null;
  pricing: Pricing | null;
  invoices: { items: readonly Invoice[]; test: boolean } | null;
  owner: boolean;
  topupAmounts: ReadonlyArray<{ paise: number; text: string }>;
  actions: { freeStart: () => Promise<Result>; topup: (paise: number) => Promise<Result> };
  mock: boolean;
};

const dateText = (iso: string | null, lang: string): string => (iso ? new Date(iso).toLocaleDateString(lang, { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" }) : "");

/**
 * Billing of design system v6 (owner 13 Nov 2026): plain-language cards. YOUR PLAN (name and price from `GET /v1/pricing`, Edit = the plan picker with its Razorpay checkout), YOUR BALANCE in rupees with the free start and ONE main button, Add money (a sheet marked TEST), and INVOICES (marked TEST until
 * C1's invoices exist). Money is ₹ and never "credits"; every money line is shown as the API or the page's test state made it.
 */
export function BillingV6({ words, lang, base, help, balance, pricing, invoices, owner, topupAmounts, actions, mock }: BillingV6Props) {
  const t = makeT(words);
  const header = (add: ReactNode) => <PageHeader title={t("bv6.title")} sub={t("bv6.sub")} right={<>{help}{add}</>} />;
  if (balance === null) {
    return (
      <main className={pageMain} lang={lang} data-part="billing-v6">
        {header(null)}
        <p className="mt-6 text-base text-muted">{t("bv6.na")}</p>
        <p className="mt-3">
          <Link href={`${base}/plans`} className={btnQuiet}>
            {t("bv6.plan.change")}
          </Link>
        </p>
      </main>
    );
  }
  const current: PricePlan | null = pricing?.plans.find((p) => p.id === balance.planId) ?? null;
  const planName = current?.name ?? balance.planName;
  const sub = balance.subscription;
  const canTopup = balance.topupAvailable;
  const sheet = <TopupSheet words={words} amounts={topupAmounts} available={canTopup} gstText={pricing?.gstText ?? null} pay={actions.topup} />;
  const showClaim = owner && !balance.freeStartGranted;
  return (
    <main className={pageMain} lang={lang} data-part="billing-v6">
      {header(sheet)}
      {mock ? (
        <p role="note" className="mt-3 text-sm text-muted">
          {t("bv6.mock")}
        </p>
      ) : null}
      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section aria-labelledby="bv6-balance" data-part="balance" className={card}>
          <h2 id="bv6-balance" className={sectionTitle}>
            {t("bv6.balance.title")}
          </h2>
          <p className="mt-2 font-display text-4xl font-semibold tabular-nums">{balance.text}</p>
          {balance.minutesEstimate !== null ? <p className="text-base text-muted">{t("bv6.balance.minutes", { n: balance.minutesEstimate })}</p> : null}
          {balance.low ? (
            <p role="note" className="mt-3 rounded-lg bg-brand-bg px-3 py-2 text-sm font-semibold text-brand-text">
              {t("bv6.balance.low")}
            </p>
          ) : null}
          {balance.freeStartLeftText ? <p className="mt-3 text-base">{t("bv6.free.left", { amount: balance.freeStartLeftText })}</p> : null}
          {showClaim ? (
            <div className={`${cardQuiet} mt-4`}>
              <p className="font-semibold">{t("bv6.free.title")}</p>
              <p className="mb-3 text-sm text-muted">{pricing?.freeStartText ?? t("bv6.free.text")}</p>
              <FreeStartButton words={words} claim={actions.freeStart} />
            </div>
          ) : null}
        </section>

        <section aria-labelledby="bv6-plan" data-part="plan" className={card}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h2 id="bv6-plan" className={sectionTitle}>
              {t("bv6.plan.title")}
            </h2>
            {owner ? (
              <Link href={`${base}/plans`} className={btnQuiet} data-part="plan-edit">
                {t("bv6.plan.change")}
              </Link>
            ) : null}
          </div>
          {planName ? (
            <>
              <p className="mt-2 font-display text-2xl font-semibold">{planName}</p>
              {current ? <p className="text-base text-muted">{current.monthlyText}</p> : null}
            </>
          ) : (
            <p className="mt-2 text-base text-muted">{t("bv6.plan.none")}</p>
          )}
          {balance.includedMinutes !== null && balance.includedMinutes > 0 && balance.includedMinutesLeft !== null ? (
            <div className="mt-3">
              <Meter label={t("bv6.plan.minutes.label")} value={balance.includedMinutes - balance.includedMinutesLeft} max={balance.includedMinutes} text={t("bv6.plan.minutes", { left: balance.includedMinutesLeft, total: balance.includedMinutes })} />
            </div>
          ) : null}
          {sub?.periodEnd ? <p className="mt-3 text-sm text-muted">{t(sub.cancelAtPeriodEnd ? "bv6.plan.ends" : "bv6.plan.renews", { date: dateText(sub.periodEnd, lang) })}</p> : null}
        </section>
      </div>

      {pricing ? (
        <section aria-labelledby="bv6-plans" data-part="plans" className="mt-4">
          <h2 id="bv6-plans" className={sectionTitle}>
            {t("bv6.plans.title")}
          </h2>
          <ul className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
            {pricing.plans.map((p) => {
              const on = p.id === balance.planId;
              return (
                <li key={p.id} data-plan={p.id} data-current={on ? "true" : undefined} className={`${card} ${on ? "!border-brand-edge" : ""}`}>
                  <p className="font-display text-lg font-semibold">{p.name}</p>
                  <p className="text-base font-semibold">{p.monthlyText}</p>
                  {p.yearlyText ? <p className="text-sm text-muted">{t("bv6.plan.yearly", { price: p.yearlyText, saving: p.yearlySavingText ?? "" }).replace(/,\s*$/, "")}</p> : null}
                  <ul className="mt-2 flex flex-col gap-1 text-sm text-muted">
                    {p.includedMinutes ? <li>{t("bv6.plan.included", { n: p.includedMinutes.toLocaleString(lang) })}</li> : null}
                    {p.rateText ? <li>{t("bv6.plan.rate", { rate: p.rateText })}</li> : null}
                    {p.numbersIncluded ? <li>{t("bv6.plan.numbers", { n: p.numbersIncluded })}</li> : null}
                    {p.leadFinder ? <li>{t("bv6.plan.finder")}</li> : null}
                  </ul>
                  <p className="mt-3 text-sm font-semibold text-brand-text">{on ? t("bv6.plan.current") : owner ? <Link href={`${base}/plans`} className="underline">{t("bv6.plan.choose")}</Link> : null}</p>
                </li>
              );
            })}
          </ul>
          {pricing.gstText ? <p className="mt-2 text-sm text-muted">{pricing.gstText}</p> : null}
        </section>
      ) : null}

      <section aria-labelledby="bv6-invoices" data-part="invoices" className={`${card} mt-4`}>
        <h2 id="bv6-invoices" className={sectionTitle}>
          {t("bv6.inv.title")}
        </h2>
        {invoices === null || invoices.items.length === 0 ? (
          <p className="mt-2 text-base text-muted">{t("bv6.inv.none")}</p>
        ) : (
          <>
            {invoices.test ? <p className="mt-1 text-sm text-muted">{t("bv6.inv.testnote")}</p> : null}
            <ul className="mt-3 flex flex-col divide-y divide-line">
              {invoices.items.map((i) => (
                <li key={i.id} data-invoice={i.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div className="min-w-0">
                    <p className="font-semibold">
                      {t(`bv6.inv.kind.${i.kind}`)}
                      {i.test ? <span className="ml-2 rounded-full bg-surface-2 px-2 text-xs font-semibold text-muted">{t("bv6.inv.test")}</span> : null}
                    </p>
                    <p className="text-sm text-muted">{dateText(i.at, lang)}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold tabular-nums">{formatRupeesShort(i.totalPaise)}</p>
                    <p className="text-sm text-muted">{t("bv6.inv.gst", { gst: formatRupeesShort(i.gstPaise || gstInside(i.totalPaise)) })}</p>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </main>
  );
}
