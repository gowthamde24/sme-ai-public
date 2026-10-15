import Link from "next/link";

import type { CampaignDetailOut } from "@contracts";

import { say, type TodayWords } from "../today/today-words";
import { card, secondary } from "../visits/styles";
import { stepPhrase } from "./campaign-logic";

/** What a campaign says and when (job CQ): the text with its merge fields as written, each step in plain words, the call plan, and what stops it from going out (the API's own checks, in our sentences). */
export function CampaignOverview({ base, campaign, words, canEdit }: { base: string; campaign: CampaignDetailOut; words: TodayWords; canEdit: boolean }) {
  const phrase = { before: (n: number) => say(words, "camp.step.before", { n }), on: () => say(words, "camp.step.on"), after: (n: number) => say(words, "camp.step.after", { n }) };
  return (
    <div data-part="overview" className="flex flex-col gap-4">
      {campaign.issues.length > 0 && campaign.status === "draft" ? (
        <section aria-labelledby="ov-issues" className="rounded-2xl border border-amber-text bg-amber-bg p-4">
          <h2 id="ov-issues" className="font-display text-lg font-bold text-amber-text">{say(words, "camp.ap.issues")}</h2>
          <ul className="mt-1 list-inside list-disc text-base text-amber-text">{campaign.issues.map((i) => (<li key={i}>{campaign.issue_text[i] ?? say(words, "camp.ap.issue.other")}</li>))}</ul>
        </section>
      ) : null}
      <section className={card}>
        <h2 className="font-display text-lg font-bold">{say(words, "camp.ov.text")}</h2>
        <p className="whitespace-pre-wrap text-base [overflow-wrap:anywhere]">{campaign.message_text}</p>
        <p className="text-sm text-muted">{say(words, `today.lang.${campaign.language}`)}</p>
      </section>
      <section className={card}>
        <h2 className="font-display text-lg font-bold">{say(words, "camp.steps.title")}</h2>
        <ol className="list-inside list-decimal text-base">
          {campaign.steps.map((s, i) => (<li key={i}>{stepPhrase(s.offset_days, phrase)}, {s.time}</li>))}
        </ol>
        {campaign.call_after_step ? <p className="text-base">{say(words, "camp.ov.call", { step: campaign.call_after_step, hours: campaign.call_wait_hours })}</p> : <p className="text-sm text-muted">{say(words, "camp.ov.nocall")}</p>}
      </section>
      {canEdit && (campaign.status === "draft" || campaign.status === "approved") ? (
        <p><Link href={`${base}/campaigns/${campaign.id}/edit`} className={secondary}>{say(words, "camp.ov.edit")}</Link></p>
      ) : null}
    </div>
  );
}
