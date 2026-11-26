import { CalendarDays, Info, MessageCircle, Mic, Phone, Target, Users, Wallet } from "lucide-react";
import Link from "next/link";
import type { Ref } from "react";

import { planChannel, type ApprovalKind, type JobPlan, type SearchPatch } from "@/lib/jobs/plan";

import { JobChip } from "../ds/JobChip";
import { makeT, type Words } from "../words";
import { SearchPlan } from "./LazySearchPlan";
import { SampleChip } from "./SampleChip";
import { Part, primary, secondary } from "./PlanPart";
import { costText, excludedTotal, findsText, hasWord, hourText, isSearchPlan, messagesCostText, waitingText, whenText, whoText } from "./plan-text";

/** `waiting`: what the Owner's OK was asked for first (`409 approval_needed`, its `approval.kind`), so the plan has no Start now. `quiet`: the test was refused for quiet hours (outside 9 am to 9 pm), so the test button is off. */
export type PlanCardState = { starting: boolean; testing: boolean; swapping: boolean; /** a Lead Finder choice is being saved */ searching?: boolean; note: string | null; error: string | null; waiting: ApprovalKind | null; quiet: boolean };

/**
 * The PLAN card (mock sheet 02): what the assistant understood, and nothing has started. Title and a Draft chip, who is left out and why (and the WhatsApp instead), then Who, What it says (with the AI line), When, What it finds out and Cost, and the buttons:
 * Start is the ONLY one that begins anything; Change by talking puts the sentence back in the box; the test goes to the owner's own phone. A plan that cannot start (`blockers`) shows why and has no Start.
 */
export function PlanCard({ plan, words, base, state, onStart, onSwap, onChange, onTest, onSearch, headingRef }: { plan: JobPlan; words: Words; /** the workspace's address, for the link to Needs you on Today */ base: string; state: PlanCardState; onStart: () => void; onSwap: () => void; onChange: () => void; onTest: () => void; /** a Lead Finder plan's choice changed (only what changed); absent = the choices are read, not changed */ onSearch?: (patch: SearchPatch) => void; headingRef?: Ref<HTMLHeadingElement> }) {
  const t = makeT(words);
  const channel = planChannel(plan);
  const left = excludedTotal(plan);
  const alt = plan.alternatives.find((a) => a.kind === "whatsapp" && a.count > 0) ?? null;
  const who = whoText(t, words, plan);
  const cost = costText(t, plan);
  const finds = findsText(t, words, plan);
  const searchPlan = isSearchPlan(plan);
  const blocked = plan.blockers.length > 0 && !searchPlan;
  const busy = state.starting || state.testing || state.swapping || state.searching === true;
  const messages = messagesCostText(t, plan);
  const swapFirst = plan.primary === "send_whatsapp" && alt !== null;
  const reasons = plan.who.excluded.filter((e) => e.count > 0).map((e) => ({ count: e.count, reason: t(`jobs.new.excl.${e.code}`) }));
  const Chan = channel === "call" ? Phone : MessageCircle;
  const waitingBox = state.waiting ? (
    <div data-part="plan-waiting" role="status" className="flex flex-col gap-1.5 rounded-xl bg-surface-2 p-3">
      <JobChip tone="wait" className="self-start">
        {waitingText(t, state.waiting)}
      </JobChip>
      <p className="m-0 text-[14px] leading-snug text-ink">{t("jobs.new.waiting.sub")}</p>
      <Link href={`${base}#needs-you`} prefetch={false} data-action="see-needs-you" className="-mb-1 inline-flex min-h-11 items-center text-[15px] font-semibold text-brand-text underline underline-offset-4">
        {t("jobs.new.waiting.link")}
      </Link>
    </div>
  ) : null;
  const from = hourText(t, plan.when.fromMin);
  const to = hourText(t, plan.when.toMin);
  return (
    <article data-part="plan" data-channel={channel} aria-labelledby="plan-title" className="jb-enter rounded-xl border border-line bg-surface p-3.5 shadow-[var(--v2-shadow)] md:p-5">
      <p className="m-0 mb-2 flex items-center gap-2 text-[11.5px] font-bold uppercase leading-tight tracking-wider text-muted">
        <span className="min-w-0 flex-1">{t("jobs.new.plan.eyebrow")}</span>
        <JobChip tone="info" className="shrink-0">
          {t("jobs.new.plan.draft")}
        </JobChip>
        {plan.sample ? <SampleChip words={words} /> : null}
      </p>
      <h2 id="plan-title" ref={headingRef} tabIndex={-1} className="m-0 mb-3 font-display text-[17px] font-bold leading-snug text-ink outline-none md:text-xl">
        {plan.title}
      </h2>
      {left > 0 ? (
        <div data-part="plan-left" className="mb-3 rounded-xl bg-surface-2 p-3 text-[14px] leading-snug text-ink">
          <p className="m-0 flex gap-2.5">
            <Info aria-hidden="true" className="mt-0.5 size-[18px] shrink-0 text-muted" />
            <span>
              <b>{t(left === 1 ? "jobs.new.left.head1" : "jobs.new.left.head", { n: left })}</b>
              {reasons.length === 1 ? <>: {t("jobs.new.left.they", { reason: reasons[0].reason })}</> : ":"}
              {alt ? <> {t("jobs.new.left.alt", { count: alt.count })}</> : null}
            </span>
          </p>
          {reasons.length > 1 ? (
            <ul className="m-0 mt-1.5 list-none p-0 pl-7 text-muted">
              {reasons.map((r) => (
                <li key={r.reason}>{t("jobs.new.left.item", r)}</li>
              ))}
            </ul>
          ) : null}
          {alt && !swapFirst ? (
            <button type="button" data-action="swap" onClick={onSwap} disabled={busy} className={`${secondary} mt-2.5`}>
              <MessageCircle aria-hidden="true" className="size-[18px]" />
              {t("jobs.new.left.alt_btn", { count: alt.count })}
            </button>
          ) : null}
        </div>
      ) : null}
      {searchPlan && plan.search ? <SearchPlan plan={plan} words={words} state={state} waitingBox={waitingBox} busy={busy} onSearch={onSearch} onStart={onStart} onChange={onChange} /> : null}
      {!blocked && !searchPlan ? (
        <>
          <Part icon={Users} label={t("jobs.new.who")} part="plan-who">
            <b>{who.lead}</b>
            {who.more ? <span className="text-muted"> {who.more}</span> : null}
          </Part>
          <Part icon={Chan} label={t("jobs.new.says")} part="plan-says">
            <blockquote className="m-0 rounded-xl bg-surface-2 px-3 py-2.5 text-[15px] leading-snug">{`“${plan.says[0]?.text ?? ""}”`}</blockquote>
          </Part>
          <Part icon={CalendarDays} label={t("jobs.new.when")} part="plan-when">
            {whenText(t, plan)}
          </Part>
          {finds.length > 0 ? (
            <Part icon={Target} label={t("jobs.new.finds")} part="plan-finds">
              {finds.join(" · ")}
            </Part>
          ) : null}
          <Part icon={Wallet} label={t("jobs.new.cost")} part="plan-cost">
            <b>{cost.lead}</b> <span className="text-muted">{cost.more}</span>
            {messages ? (
              <span data-part="plan-cost-messages" className="mt-0.5 block text-[14px] text-muted">
                {messages}
              </span>
            ) : null}
          </Part>
          <div className="mt-1 flex flex-col gap-2.5 border-t border-line pt-3.5">
            {state.error ? (
              <p role="alert" className="m-0 text-sm text-red-text">
                {state.error}
              </p>
            ) : null}
            {waitingBox ?? (
              <button type="button" data-action="start" onClick={swapFirst ? onSwap : onStart} disabled={busy} className={primary}>
                {state.starting ? t("jobs.new.starting") : swapFirst && alt ? t("jobs.new.start.whatsapp", { count: alt.count }) : t("jobs.new.start")}
              </button>
            )}
            <div className="grid gap-2.5 sm:grid-cols-2">
              <button type="button" data-action="change" onClick={onChange} disabled={busy} className={secondary}>
                <Mic aria-hidden="true" className="size-[18px]" />
                {t("jobs.new.change")}
              </button>
              <button type="button" data-action="test" onClick={onTest} disabled={busy || state.quiet} className={secondary}>
                <Chan aria-hidden="true" className="size-[18px]" />
                {t(channel === "call" ? "jobs.new.test.call" : "jobs.new.test.message")}
              </button>
            </div>
            {channel === "call" && !state.quiet && plan.cost.rupees === null ? (
              <p data-part="test-cost" className="m-0 text-[13px] leading-snug text-muted">
                {t("jobs.new.test.cost")}
              </p>
            ) : null}
            {state.note ? (
              <p role="status" data-part="test-note" className="m-0 text-sm font-semibold text-ink">
                {state.note}
              </p>
            ) : null}
            <p className="m-0 text-[13px] leading-snug text-muted">
              {t(channel === "call" ? "jobs.new.safe.call" : "jobs.new.safe.whatsapp", { from, to })}
              {plan.expiresInMinutes ? ` ${t("jobs.new.expires", { n: plan.expiresInMinutes })}` : ""}
            </p>
          </div>
        </>
      ) : blocked ? (
        <p role="status" data-part="plan-blocked" className="m-0 text-[15px] text-ink">
          {t(hasWord(words, `jobs.new.blocker.${plan.blockers[0]}`) ? `jobs.new.blocker.${plan.blockers[0]}` : "jobs.new.blocker.other")}
        </p>
      ) : null}
    </article>
  );
}

export default PlanCard;
