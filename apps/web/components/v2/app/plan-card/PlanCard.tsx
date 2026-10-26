"use client";

import Link from "next/link";
import * as React from "react";

import { formatRupeesShort } from "@/lib/money";

import { alertBox, btnMain, checkBox, checkRow, mutedText, okBox, pillAmber, pillBrand, pillGreen, pillNeutral, surface } from "../ui";
import { makeT, type Words } from "../words";

/**
 * THE PLAN CARD (night 4, owner decision "approve once, not per contact"): one plan for a whole batch, shown the same way wherever it comes from (an upload, a list, a task, a lead source's standing rule): WHO (a count and a few
 * names, each with a tick to leave one out), the goal, what Vijaya asks, when, an estimate, the limits, and ONE "Approve all" button. Approving is the Owner's, with the second factor; nobody clicks per contact. A plain view: the
 * parent owns the data, the exclusions and the approval (a server action), this draws them. The estimate and the limits are numbers the system calculated (never the model); `simulated` says no real call or message is made.
 */
export type PlanWho = { count: number; sample: readonly { id: string; name: string }[]; /** Contacts left out so far (their ids), by the parent. */ excluded: ReadonlySet<string>; /** Why some people are left out already ("no consent: 2"), plain sentences. */ skipped?: readonly string[] };
export type PlanEstimate = { minutes?: number | null; calls?: number | null; messages?: number | null; costPaise?: number | null };
export type PlanLimits = { callsPerDay?: number | null; totalMinutes?: number | null; capPaise?: number | null };
export type ApproveResult = { ok: true } | { ok: false; error: "mfa" | "changed" | "read_only" | "nobody" | "down" };
export type PlanCardProps = {
  words: Words;
  title: string;
  who: PlanWho;
  goal: string;
  questions: readonly string[];
  /** How it is done, in words ("Calls and WhatsApp"). */
  channel: string;
  /** When, in words ("Today, 10:00 to 19:00"). */
  when: string;
  estimate: PlanEstimate;
  limits?: PlanLimits;
  /** Closed sentences the API adds ("promotional calls are off: WhatsApp only"). */
  notes?: readonly string[];
  simulated?: boolean;
  /** `planned`: can be approved; any other: it is shown as it stands. */
  state: "planned" | "approved" | "running" | "paused" | "done" | "cancelled";
  canApprove: boolean;
  /** "Everyone" list or other detail, drawn under the names. */
  detail?: React.ReactNode;
  onExclude: (id: string, excluded: boolean) => void;
  onApprove: () => Promise<ApproveResult>;
  securityHref?: string;
};

const stateWord: Record<PlanCardProps["state"], string> = { planned: "pc.state.planned", approved: "pc.state.approved", running: "pc.state.running", paused: "pc.state.paused", done: "pc.state.done", cancelled: "pc.state.cancelled" };

export function PlanCard(p: PlanCardProps) {
  const t = makeT(p.words);
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<ApproveResult | null>(null);
  const included = Math.max(0, p.who.count - p.who.excluded.size);
  const hidden = Math.max(0, p.who.count - p.who.sample.length);
  const e = p.estimate;
  const parts = [e.minutes ? t("pc.estimate.minutes", { n: e.minutes }) : null, e.calls ? t("pc.estimate.calls", { n: e.calls }) : null, e.messages ? t("pc.estimate.messages", { n: e.messages }) : null, e.costPaise != null ? t("pc.estimate.cost", { cost: formatRupeesShort(e.costPaise) }) : null].filter((x): x is string => x !== null);
  const lim = p.limits ?? {};
  const limits = [lim.callsPerDay ? t("pc.limits.calls", { n: lim.callsPerDay }) : null, lim.totalMinutes ? t("pc.limits.minutes", { n: lim.totalMinutes }) : null, lim.capPaise != null ? t("pc.limits.cap", { cost: formatRupeesShort(lim.capPaise) }) : null].filter((x): x is string => x !== null);
  const planned = p.state === "planned";
  const approve = async () => {
    setBusy(true);
    let out: ApproveResult;
    try {
      out = await p.onApprove();
    } catch {
      out = { ok: false, error: "down" };
    }
    setBusy(false);
    setResult(out);
  };
  return (
    <section data-part="plan-card" data-state={p.state} aria-labelledby="plan-card-h" className={`${surface} flex flex-col gap-4`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="plan-card-h" className="font-display text-xl font-bold leading-tight">
          {p.title}
        </h3>
        <span className={p.state === "done" || p.state === "approved" || p.state === "running" ? pillGreen : p.state === "paused" ? pillAmber : p.state === "planned" ? pillBrand : pillNeutral}>{t(stateWord[p.state])}</span>
      </div>
      {p.simulated ? (
        <p data-part="simulated" role="note" className={`${mutedText} !mt-0`}>
          {t("pc.simulated")}
        </p>
      ) : null}
      <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-[max-content_1fr]">
        <dt className="text-sm font-semibold text-muted">{t("pc.who")}</dt>
        <dd data-part="who" className="min-w-0">
          <p className="font-semibold">{t(included === 1 ? "pc.who.one" : "pc.who.count", { n: included })}</p>
          {p.who.sample.length > 0 ? (
            <ul className="mt-1 flex flex-col">
              {p.who.sample.map((s) => {
                const out = p.who.excluded.has(s.id);
                return (
                  <li key={s.id}>
                    <label className={checkRow}>
                      <input type="checkbox" className={checkBox} checked={!out} disabled={!planned || busy} onChange={(ev) => p.onExclude(s.id, !ev.target.checked)} />
                      <span className={out ? "text-muted line-through" : ""}>{s.name}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {hidden > 0 ? <p className={`${mutedText} !mt-0`}>{t("pc.who.more", { n: hidden })}</p> : null}
          {planned && p.who.sample.length > 0 ? <p className={`${mutedText} !mt-1`}>{t("pc.who.hint")}</p> : null}
          {(p.who.skipped ?? []).length > 0 ? <p className={`${mutedText} !mt-1`}>{t("pc.skipped", { list: (p.who.skipped ?? []).join(", ") })}</p> : null}
          {p.detail}
        </dd>
        <dt className="text-sm font-semibold text-muted">{t("pc.goal")}</dt>
        <dd className="min-w-0 break-words">{p.goal}</dd>
        <dt className="text-sm font-semibold text-muted">{t("pc.channel")}</dt>
        <dd>{p.channel}</dd>
        {p.questions.length > 0 ? (
          <>
            <dt className="text-sm font-semibold text-muted">{t("pc.questions")}</dt>
            <dd>
              <ol className="list-inside list-decimal">
                {p.questions.map((q, i) => (
                  <li key={i} className="break-words">
                    {q}
                  </li>
                ))}
              </ol>
            </dd>
          </>
        ) : null}
        <dt className="text-sm font-semibold text-muted">{t("pc.when")}</dt>
        <dd>{p.when}</dd>
        <dt className="text-sm font-semibold text-muted">{t("pc.estimate")}</dt>
        <dd data-part="estimate">
          {parts.length > 0 ? parts.join(" · ") : t("pc.estimate.none")}
          <span className={`${mutedText} !mt-0 block`}>{t("pc.estimate.note")}</span>
        </dd>
        {limits.length > 0 ? (
          <>
            <dt className="text-sm font-semibold text-muted">{t("pc.limits")}</dt>
            <dd data-part="limits">{limits.join(" · ")}</dd>
          </>
        ) : null}
      </dl>
      {(p.notes ?? []).length > 0 ? (
        <ul data-part="notes" className="list-inside list-disc text-sm text-muted">
          {(p.notes ?? []).map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      ) : null}
      {planned ? (
        <div className="flex flex-col gap-2">
          <button type="button" className={btnMain} disabled={!p.canApprove || busy || included === 0 || result?.ok === true} onClick={() => void approve()}>
            {busy ? t("pc.approving") : t("pc.approve", { n: included })}
          </button>
          <p className={`${mutedText} !mt-0`}>{p.canApprove ? t("pc.approve.help") : t("pc.approve.owner")}</p>
        </div>
      ) : null}
      {result?.ok ? (
        <p role="status" className={`${okBox} !mt-0`}>
          {t("pc.approved")}
        </p>
      ) : null}
      {result && !result.ok ? (
        <p role="alert" className={`${alertBox} !mt-0`}>
          {t(`pc.err.${result.error}` as "pc.err.down")}{" "}
          {result.error === "mfa" && p.securityHref ? (
            <Link href={p.securityHref} className="font-semibold underline">
              {t("pc.err.mfa.link")}
            </Link>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}
