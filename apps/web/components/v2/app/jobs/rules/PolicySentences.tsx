"use client";

import Link from "next/link";

import { fmtMinutes } from "@/lib/jobs/detail";
import type { Policy } from "@/lib/outreach/types";

import { btnQuiet, mutedText } from "../../ui";
import { buildSteps, retryPhrase } from "../../outreach/plan-text";
import { makeT, type Words } from "../../words";
import { jobCard } from "../detail/types";
import { gapText, Sentence, Val } from "./parts";

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/**
 * "Calling hours and tries" as sentences with the values inside (JOBS, the simplicity pass): "Call between 9:30 am and 7 pm, Mon, Tue ... Sat. If nobody answers, try 3 times, 2 hours apart."
 * These come from the assistant's calling hours and tries, so they are read here and changed in Settings (the same link as before); nothing is lost, the plain facts of before are all in the sentences.
 */
export function PolicySentences({ words, policy, changeHref }: { words: Words; policy: Policy; changeHref: string }) {
  const t = makeT(words);
  const days = policy.hours.days.map((d) => words[`asst.day.${DAY_KEYS[d - 1]}`] ?? "").join(", ");
  const retry = policy.retrySteps ? retryPhrase(t, buildSteps(0, policy.retrySteps, null)) : null;
  const gapMinutes = Math.round(policy.retryGapHours * 60);
  return (
    <section data-part="policy" data-simple="" className={`${jobCard} flex flex-col gap-1`}>
      <Sentence line="hours" template={t("jobs.rules.hours.line")} parts={{ from: () => <Val>{fmtMinutes(policy.hours.fromMinute)}</Val>, to: () => <Val>{fmtMinutes(policy.hours.toMinute)}</Val>, days: () => <Val>{days}</Val> }} />
      {retry ? (
        <Sentence line="tries" template={t("jobs.rules.tries.steps")} parts={{ steps: () => <b className="font-semibold">{retry}</b> }} />
      ) : (
        <Sentence line="tries" template={t("jobs.rules.tries.n")} parts={{ n: () => <Val>{t(policy.maxAttempts === 1 ? "jobs.rules.times_one" : "jobs.rules.times", { n: policy.maxAttempts })}</Val>, gap: () => <Val>{gapText(t, gapMinutes)}</Val> }} />
      )}
      {policy.thenWhatsapp ? <p className="m-0 text-[15px] text-ink">{t("jobs.rules.wa_end")}</p> : null}
      <p className="m-0 text-[15px] text-ink">{t("jobs.rules.night", { time: fmtMinutes(policy.nightCallMinute) })}</p>
      <p className="m-0 text-[15px] text-ink">{t("jobs.rules.handoff", { n: policy.handoffReminderMinutes })}</p>
      <p className={`${mutedText} !mt-1`}>{t("ol.policy.stop")}</p>
      <div className="mt-1">
        <Link href={changeHref} className={btnQuiet}>
          {t("ol.policy.change")}
        </Link>
      </div>
    </section>
  );
}
