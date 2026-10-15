import Link from "next/link";

import type { CampaignDetailOut } from "@contracts";

import { formatRupees } from "@/lib/money";

import { Pill } from "../parts";
import { say, type TodayWords } from "../today/today-words";
import { backLink } from "../ui";

export const TABS = ["overview", "audience", "approve", "results"] as const;
export type Tab = (typeof TABS)[number];
const TONE: Record<string, "green" | "info" | "neutral" | "amber"> = { draft: "neutral", approved: "info", running: "green", paused: "amber", done: "neutral", cancelled: "neutral" };

/** The frame of one campaign (job CQ): its name and status, the four tabs (overview, who, check and approve, results) and whatever the tab shows. */
export function CampaignHub({ base, words, campaign, tab, children, notice }: { base: string; words: TodayWords; campaign: CampaignDetailOut; tab: Tab; children: React.ReactNode; notice?: React.ReactNode }) {
  const here = `${base}/campaigns/${campaign.id}`;
  return (
    <div data-screen="campaign" className="flex flex-col gap-5">
      <p><Link href={`${base}/campaigns`} className={backLink}>{say(words, "camp.back")}</Link></p>
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-[26px] font-semibold leading-[1.15] [overflow-wrap:anywhere] md:text-4xl md:leading-[1.1]">{campaign.name}</h1>
        <p className="flex flex-wrap items-center gap-2 text-base text-muted">
          <Pill tone={TONE[campaign.status] ?? "neutral"}>{say(words, `camp.status.${campaign.status}`)}</Pill>
          <span>{say(words, `camp.kind.${campaign.kind}`)} · {say(words, "camp.people", { n: campaign.recipients })}{campaign.total_amount_paise > 0 ? ` · ${formatRupees(campaign.total_amount_paise)}` : ""}</span>
        </p>
      </header>
      {notice}
      <nav aria-label={say(words, "camp.tabs")} className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {TABS.map((k) => (
          <Link key={k} href={k === "overview" ? here : `${here}?tab=${k}`} aria-current={tab === k ? "page" : undefined} className={`inline-flex min-h-11 shrink-0 items-center rounded-full border px-4 text-base font-semibold ${tab === k ? "border-brand-text bg-brand-bg text-brand-text" : "border-edge"}`}>{say(words, `camp.tab.${k}`)}</Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
