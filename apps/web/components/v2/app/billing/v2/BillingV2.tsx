import { AlertTriangle, Check, Clock, Info } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import type { UsageLine, Wallet } from "@/lib/api/wallet";
import { formatRupeesShort } from "@/lib/money";
import { PLAN_KEYS, PLAN_KEY_NAMES, type PlanKey } from "@/lib/plan/names";
import { EXTRA_NUMBER_PAISE, MINUTE_PAISE, NUMBERS_INCLUDED, PLAN_TERMS } from "@/lib/plan/plans-v2";
import { projectUsage, upgradeHint } from "@/lib/plan/upgrade-hint";

import { PageHeader } from "../../ds/PageHeader";
import { InlineError } from "../../ds/InlineError";
import { MoreChoices } from "../../jobs/rules/parts";
import { btnQuiet, pageMain } from "../../ui";
import { card, cardQuiet, sectionTitle } from "../../v6/ui";
import { makeT, type Say, type Words } from "../../words";
import { FreeStartButton } from "../FreeStartButton";
import { TopupSheet } from "../TopupSheet";

import { LimitLine } from "./LimitLine";

type Result = { ok: true } | { ok: false; error: string };
export type BillingV2Props = {
  words: Words;
  lang: string;
  base: string;
  help: ReactNode;
  /** null = billing could not be read. */
  wallet: Wallet | null;
  owner: boolean;
  topupAmounts: ReadonlyArray<{ paise: number; text: string }>;
  actions: { freeStart: () => Promise<Result>; topup: (paise: number) => Promise<Result>; setLimit: (feature: string, paise: number | null) => Promise<Result> };
  /** CALLS_PANEL: "How calls are billed", drawn by the page before the "How billing works" folds; null = nothing */
  facts?: ReactNode;
};

const TONE_ICON = { done: Check, wait: Clock, fail: AlertTriangle, info: Info } as const;
/** The ONE solid status chip of this screen (design/billing.css): amber 80%, red 100% and stopped, neutral for Preview. The icon always sits with the word. */
function Chip({ tone, children }: { tone: keyof typeof TONE_ICON; children: ReactNode }) {
  const Icon = TONE_ICON[tone];
  return (
    <span className="bl-chip" data-tone={tone}>
      <Icon aria-hidden="true" />
      {children}
    </span>
  );
}

/** A thin bar of how much is used (a real <progress>, so a screen reader says it); its colour is the state's (design/billing.css: green, amber at 80, red at 100). The words beside it say the same, so the bar is never the only sign. */
function Bar({ label, value, max }: { label: string; value: number; max: number }) {
  const safe = max > 0 ? max : 1;
  return <progress value={Math.min(Math.max(value, 0), safe)} max={safe} aria-label={label} className="h-2.5 w-full" />;
}

const CHOICES = { calls: [50_000, 100_000, 200_000, 500_000], find_customers: [20_000, 50_000, 100_000], whatsapp: [20_000, 50_000, 100_000] } as const;
const SENTENCE = { calls: "bill.limit.calls", find_customers: "bill.limit.find", whatsapp: "bill.limit.wa" } as const;
const dateText = (iso: string | null, lang: string): string => (iso ? new Date(iso).toLocaleDateString(lang, { day: "numeric", month: "long", timeZone: "Asia/Kolkata" }) : "");

/** The one sentence under a chip: what the 80% or 100% mark means for this line, in plain words. */
function warnSentence(t: Say, line: UsageLine): string | null {
  if (line.warn === "none") return null;
  if (line.limitPaise !== null) return t(line.warn === "at100" ? "bill.warn.limit.at100" : "bill.warn.limit.at80", { limit: formatRupeesShort(line.limitPaise) });
  if (line.feature === "calls") return line.warn === "at100" ? t("bill.warn.calls.at100", { rate: formatRupeesShort(line.unitPaise ?? MINUTE_PAISE) }) : t("bill.warn.calls.at80");
  if (line.feature === "find_customers") return line.warn === "at100" ? t("bill.warn.find.at100", { price: formatRupeesShort(line.unitPaise ?? 0) }) : t("bill.warn.find.at80");
  return null;
}

/**
 * Billing v2 (BILLING_V2; owner's final pricing, 19 Nov 2026): ONE ₹ wallet, big; the usage of this month on one line per feature (calls with minutes used of the plan, phone numbers, Find customers, WhatsApp at Meta's cost); an optional spending limit per feature as a plain
 * sentence with the amount inside; warnings at 80% and 100% as solid chips with one sentence each; the upgrade hint when another plan would cost less this month; numbers on demand ("Add a number" goes to the Phone number page, nothing is bought here); and, under one "More choices", the three plans and how
 * billing works. Money is ₹ and never "credits"; no plan is called "unlimited". A made-up month (mock) is marked "Preview" at the top: the paid-plan parts (limits, warnings, numbers) start with paid plans, so nothing here is claimed as live.
 */
export function BillingV2({ words, lang, base, help, wallet, owner, topupAmounts, actions, facts }: BillingV2Props) {
  const t = makeT(words);
  const num = (n: number) => n.toLocaleString(lang, { maximumFractionDigits: 1 });
  if (wallet === null) {
    return (
      <main className={pageMain} lang={lang} data-part="billing-v2" data-bill="2">
        <PageHeader title={t("bill.title")} sub={t("bill.sub")} right={help} />
        <InlineError text={t("bv6.na")} retry={t("bv6.retry")} />
      </main>
    );
  }
  const by = (f: UsageLine["feature"]) => wallet.lines.find((l) => l.feature === f) ?? null;
  const calls = by("calls");
  const numbers = by("numbers");
  const find = by("find_customers");
  const wa = by("whatsapp");
  const hint = (() => {
    if (wallet.planKey === null || calls === null) return null;
    const usage = projectUsage({ minutes: calls.used, searches: find?.used ?? 0, numbers: numbers?.used ?? NUMBERS_INCLUDED }, wallet.day ?? 0, wallet.days ?? 0);
    const h = upgradeHint(wallet.planKey, usage);
    return h ? { ...h, name: PLAN_KEY_NAMES[h.plan] } : null;
  })();
  const empty = wallet.balancePaise <= 0;
  const preview = wallet.source === "mock";
  const planBy = (k: PlanKey) => PLAN_TERMS[k];
  const sheet = <TopupSheet words={words} amounts={topupAmounts} available={wallet.topupAvailable} gstText={null} pay={actions.topup} />;
  const showClaim = owner && !wallet.freeStartGranted;

  const limitRow = (line: UsageLine | null) =>
    line !== null && (line.feature === "calls" || line.feature === "find_customers" || line.feature === "whatsapp") ? (
      wallet.limitsAvailable ? (
        <LimitLine key={`${line.feature}-${line.limitPaise ?? "none"}`} words={words} sentence={SENTENCE[line.feature]} feature={line.feature} valuePaise={line.limitPaise} choices={CHOICES[line.feature]} disabled={false} setLimit={actions.setLimit} />
      ) : null
    ) : null;
  const warnRow = (line: UsageLine | null) => {
    if (line === null || line.warn === "none") return null;
    const sentence = warnSentence(t, line);
    return (
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2" data-part="warn" data-warn={line.warn}>
        {line.paused ? <Chip tone="fail">{t("bill.warn.paused")}</Chip> : line.warn === "at100" ? <Chip tone="fail">{t("bill.warn.at100")}</Chip> : <Chip tone="wait">{t("bill.warn.at80")}</Chip>}
        {sentence ? <p className="m-0 min-w-0 flex-1 basis-60 text-[15px]">{sentence}</p> : null}
      </div>
    );
  };
  const row = (id: string, title: string, line: UsageLine | null, body: ReactNode) => (
    <li key={id} data-line={id} data-warn={line?.warn ?? "none"} className="flex flex-col gap-1.5 py-4 first:pt-1 last:pb-1">
      <h3 className="m-0 font-display text-base font-semibold">{title}</h3>
      {body}
    </li>
  );

  return (
    <main className={pageMain} lang={lang} data-part="billing-v2" data-bill="2" data-source={wallet.source}>
      <PageHeader title={t("bill.title")} sub={t("bill.sub")} right={<>{help}{sheet}</>} />
      {preview ? (
        <p role="note" data-part="preview" className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-[15px]">
          <Chip tone="info">{t("bill.preview")}</Chip>
          <span className="min-w-0 flex-1 basis-60">{t("bill.preview.text")}</span>
        </p>
      ) : null}

      <section aria-labelledby="bl-wallet" data-part="wallet" className={`${card} mt-5`}>
        <h2 id="bl-wallet" className={sectionTitle}>
          {t("bill.wallet.title")}
        </h2>
        <p className="mt-2 font-display text-5xl font-semibold tabular-nums" data-part="balance">
          {formatRupeesShort(wallet.balancePaise)}
        </p>
        {wallet.minutesEstimate !== null ? <p className="text-base text-muted">{t("bill.wallet.minutes", { n: wallet.minutesEstimate })}</p> : null}
        {empty || wallet.low ? (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2" data-part="wallet-warn" data-warn={empty ? "at100" : "at80"}>
            {empty ? <Chip tone="fail">{t("bill.wallet.empty")}</Chip> : <Chip tone="wait">{t("bill.wallet.low")}</Chip>}
            <p className="m-0 min-w-0 flex-1 basis-60 text-[15px]">{t(empty ? "bill.wallet.empty.text" : "bill.wallet.low.text")}</p>
          </div>
        ) : null}
        {wallet.freeStartLeftText ? <p className="mt-3 text-base">{t("bv6.free.left", { amount: wallet.freeStartLeftText })}</p> : null}
        <p className="mt-3 text-sm text-muted">{t("bill.wallet.carry")}</p>
        {showClaim ? (
          <div className={`${cardQuiet} mt-4`}>
            <p className="font-semibold">{t("bv6.free.title")}</p>
            <p className="mb-3 text-sm text-muted">{t("bill.how.start")}</p>
            <FreeStartButton words={words} claim={actions.freeStart} />
          </div>
        ) : null}
      </section>

      {hint ? (
        <section aria-label={t("bill.hint.save", { amount: formatRupeesShort(hint.savePaise), plan: hint.name })} data-part="upgrade-hint" data-plan={hint.plan} className={`${cardQuiet} mt-4 flex flex-wrap items-center justify-between gap-3`}>
          <div className="min-w-0">
            <p className="m-0 text-base font-semibold">{t("bill.hint.save", { amount: formatRupeesShort(hint.savePaise), plan: hint.name })}</p>
            <p className="m-0 text-sm text-muted">{t("bill.hint.basis")}</p>
          </div>
          {owner ? (
            <Link href={`${base}/plans`} className={btnQuiet} data-part="hint-link">
              {t("bill.hint.see", { plan: hint.name })}
            </Link>
          ) : null}
        </section>
      ) : null}

      <section aria-labelledby="bl-usage" data-part="usage" className={`${card} mt-4`}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="bl-usage" className={sectionTitle}>
            {t("bill.usage.title")}
          </h2>
          <p className="m-0 text-sm text-muted">
            {wallet.planName ? <b>{wallet.planName}</b> : null}
            {wallet.planRenews ? <> · {t("bill.until", { date: dateText(wallet.planRenews, lang) })}</> : null}
          </p>
        </div>
        <ul className="mt-3 flex list-none flex-col divide-y divide-line p-0">
          {calls
            ? row("calls", t("bill.f.calls"), calls, (
                <>
                  <p className="m-0 text-base">{calls.included ? t("bill.calls.used", { used: num(calls.used), included: num(calls.included) }) : t("bill.calls.payg", { used: num(calls.used), rate: formatRupeesShort(calls.unitPaise ?? MINUTE_PAISE) })}</p>
                  {calls.included ? <Bar label={t("bill.f.calls")} value={calls.used} max={calls.included} /> : null}
                  {calls.included && calls.used > calls.included ? <p className="m-0 text-sm text-muted">{t("bill.calls.extra", { n: num(calls.used - calls.included), amount: formatRupeesShort(calls.spentPaise) })}</p> : null}
                  {warnRow(calls)}
                  {limitRow(calls)}
                </>
              ))
            : null}
          {numbers || wallet.source !== "balance"
            ? row("numbers", t("bill.f.numbers"), numbers, (
                <>
                  <p className="m-0 text-base">{(numbers?.used ?? 1) === 1 ? t("bill.numbers.have.one") : t("bill.numbers.have", { n: numbers?.used ?? 1 })}</p>
                  <p className="m-0 text-sm text-muted">{t("bill.numbers.rule", { price: formatRupeesShort(EXTRA_NUMBER_PAISE) })}</p>
                  {numbers && numbers.spentPaise > 0 ? <p className="m-0 text-sm text-muted">{t("bill.numbers.extra", { amount: formatRupeesShort(numbers.spentPaise) })}</p> : null}
                  {owner ? (
                    <p className="m-0 mt-1">
                      <Link href={`${base}/phone-number`} className={btnQuiet} data-part="add-number">
                        {t("bill.numbers.add")}
                      </Link>
                    </p>
                  ) : null}
                </>
              ))
            : null}
          {find
            ? row("find_customers", t("bill.f.find"), find, (
                <>
                  <p className="m-0 text-base">{find.included ? t("bill.find.used", { used: num(find.used), free: num(find.included) }) : null}</p>
                  {find.included ? <Bar label={t("bill.f.find")} value={find.used} max={find.included} /> : null}
                  <p className="m-0 text-sm text-muted">{t("bill.find.then", { price: formatRupeesShort(find.unitPaise ?? 0) })}</p>
                  {find.included && find.used > find.included ? <p className="m-0 text-sm text-muted">{t("bill.find.paid", { n: num(find.used - find.included), amount: formatRupeesShort(find.spentPaise) })}</p> : null}
                  {warnRow(find)}
                  {limitRow(find)}
                </>
              ))
            : null}
          {wa
            ? row("whatsapp", t("bill.f.whatsapp"), wa, (
                <>
                  <p className="m-0 text-base">{t("bill.wa.spent", { amount: formatRupeesShort(wa.spentPaise) })}</p>
                  <p className="m-0 text-sm text-muted">{t("bill.wa.rule")}</p>
                  {warnRow(wa)}
                  {limitRow(wa)}
                </>
              ))
            : null}
        </ul>
        {wallet.source === "balance" ? <p className="mt-3 text-sm text-muted">{t("bill.usage.soon")}</p> : null}
        {wallet.limitsAvailable ? <p className="mt-3 text-sm text-muted">{t("bill.limit.help")}</p> : <p className="mt-3 text-sm text-muted">{t("bill.limit.na")}</p>}
      </section>

      <div className="mt-4">
        {facts}
        <MoreChoices title={t("bill.how.title")} sub={t("bill.how.sub")}>
          <section aria-labelledby="bl-plans" data-part="plans">
            <h3 id="bl-plans" className="m-0 font-display text-base font-semibold">
              {t("bill.plans.title")}
            </h3>
            <p className="m-0 mb-3 text-sm text-muted">{t("bill.plans.every")}</p>
            <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-3">
              {PLAN_KEYS.map((k) => {
                const p = planBy(k);
                const on = wallet.planKey === k;
                return (
                  <li key={k} data-plan={k} data-current={on ? "true" : undefined} className={`${cardQuiet} flex flex-col gap-1 ${on ? "!border-brand-edge" : ""}`}>
                    <p className="m-0 flex flex-wrap items-center gap-2 font-display text-lg font-semibold">
                      {PLAN_KEY_NAMES[k]}
                      {p.popular ? <Chip tone="info">{t("bill.plan.popular")}</Chip> : null}
                    </p>
                    <p className="m-0 text-base font-semibold">{t("bill.plan.price", { price: formatRupeesShort(p.monthlyPaise) })}</p>
                    <p className="m-0 text-sm text-muted">{p.includedMinutes > 0 ? t("bill.plan.minutes", { n: p.includedMinutes.toLocaleString(lang), rate: formatRupeesShort(MINUTE_PAISE) }) : t("bill.plan.minutes.payg", { rate: formatRupeesShort(MINUTE_PAISE) })}</p>
                    <p className="m-0 text-sm text-muted">{t("bill.plan.searches", { free: p.freeSearches, price: formatRupeesShort(p.searchPaise) })}</p>
                    <p className="m-0 text-sm text-muted">{t("bill.plan.numbers", { price: formatRupeesShort(EXTRA_NUMBER_PAISE) })}</p>
                    <p className="m-0 text-sm text-muted">{p.priorityOnboarding ? t("bill.plan.priority") : t("bill.plan.self")}</p>
                    {on ? (
                      <p className="m-0 mt-1 text-sm font-semibold text-brand-text">{t("bill.plan.current")}</p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-sm text-muted">{t("bill.plans.gst")}</p>
            {owner ? (
              <p className="mt-3">
                <Link href={`${base}/plans`} className={btnQuiet} data-part="plan-edit">
                  {t("bill.plan.change")}
                </Link>
              </p>
            ) : null}
          </section>
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[15px]" data-part="how">
            <li>{t("bill.how.30s")}</li>
            <li>{t("bill.how.ai")}</li>
            <li>{t("bill.how.carry")}</li>
            <li>{t("bill.how.readonly")}</li>
            <li>{t("bill.how.start")}</li>
          </ul>
        </MoreChoices>
      </div>
    </main>
  );
}
