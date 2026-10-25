import Link from "next/link";

import type { CampaignOut } from "@contracts";

import { formatRupees } from "@/lib/money";

import { OrbMark } from "../mark/OrbMark";
import { Pill } from "../parts";
import { say, type TodayWords } from "../today/today-words";
import type { Role } from "../today/types";
import { card, okLine, primary, quiet } from "../visits/styles";

const TONE: Record<string, "green" | "info" | "neutral" | "amber"> = { draft: "neutral", approved: "info", running: "green", paused: "amber", done: "neutral", cancelled: "neutral" };

/** The campaigns of the business, newest first (job CQ): name, kind, status, how many people and how much money. Owner, Admin and Sales make drafts; the Owner approves. Nothing here sends. */
export function CampaignsView({ base, words, role, campaigns, more, saved, help, announcements = false }: { base: string; words: TodayWords; role: Role; campaigns: readonly CampaignOut[] | null; more: string | null; saved: boolean; help?: React.ReactNode; announcements?: boolean }) {
  const writer = role !== "viewer";
  const addHref = announcements ? `${base}/announcements/new` : `${base}/campaigns/new`;
  return (
    <div data-screen="campaigns" className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="font-display text-[26px] font-semibold leading-[1.15] md:text-4xl md:leading-[1.1]">{say(words, announcements ? "nav.item.announcements" : "nav.item.campaigns")}</h1>
          <p className="text-base text-muted">{say(words, announcements ? "camp.ann.sub" : "camp.sub")}</p>
        </div>
        {writer && campaigns !== null && campaigns.length > 0 ? <Link href={addHref} className={primary}>{say(words, announcements ? "camp.ann.add" : "camp.add")}</Link> : null}
      </header>
      {saved ? <p role="status" className={okLine}>{say(words, "camp.saved")}</p> : null}
      {help}
      {campaigns === null ? (
        <p role="alert" className="rounded-2xl border border-line p-4 text-base">{say(words, "camp.loaderr")}</p>
      ) : campaigns.length === 0 ? (
        <div className="flex max-w-xl items-start gap-4 rounded-[20px] border border-line bg-surface p-4 md:p-5" data-part="empty">
          <OrbMark px={72} className="size-[72px]" />
          <div className="min-w-0">
            <p className="font-semibold">{say(words, announcements ? "camp.ann.empty.title" : "camp.empty.title")}</p>
            <p className="text-base text-muted">{say(words, announcements ? "camp.ann.empty.body" : "camp.empty.body")}</p>
            {writer ? <p className="mt-3"><Link href={addHref} className={primary}>{say(words, announcements ? "camp.ann.add" : "camp.add")}</Link></p> : null}
          </div>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {campaigns.map((c) => (
            <li key={c.id}>
              <Link href={`${base}/campaigns/${c.id}`} className={`${card} min-h-11 hover:bg-surface-2`}>
                <span className="flex flex-wrap items-start justify-between gap-2">
                  <span className="min-w-0 font-display text-lg font-bold [overflow-wrap:anywhere]">{c.name}</span>
                  <Pill tone={TONE[c.status] ?? "neutral"}>{say(words, `camp.status.${c.status}`)}</Pill>
                </span>
                <span className="text-sm text-muted">{say(words, `camp.kind.${c.kind}`)} · {say(words, "camp.people", { n: c.recipients })}{c.total_amount_paise > 0 ? ` · ${formatRupees(c.total_amount_paise)}` : ""}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {more ? <p><Link href={more} className={quiet}>{say(words, "mat.products.more")}</Link></p> : null}
    </div>
  );
}
