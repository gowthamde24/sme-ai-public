import type { ReactNode } from "react";
import Link from "next/link";

import { DUE_TEXT, followupSentence } from "@/lib/api/followup-text";
import { type DueList } from "@/lib/api/followups";

import { channelsLine, dueEmptyLine, dueLine, leftOutLine } from "./followup-logic";
import { hintInline, link, listItemCard, mutedText, pageH1 } from "@/components/v2/app/ui";
import { makeT, sayText, type Words } from "@/components/v2/app/words";

/**
 * The leads with a recorded first message, each put to the pinned rules when this page was opened (there is no scheduler and nothing runs in the background). It is GUIDANCE: opening a lead and
 * asking for a draft makes the database decide again. One row per LEAD: it names the state of each channel (when the API reported them) and the row opens the lead on the channel to start with. The list is one PAGE,
 * oldest last message first; leads that need no follow-up are not listed; a link goes to the next page; a note says how many candidates of this page could not be shown. Nothing here sends a message.
 */
export function DueView({ tenantId, list, tabs = null, words }: { tenantId: string; list: DueList; tabs?: ReactNode; words?: Words; }) {
  const t = makeT(words);
  const base = `/app/tenants/${tenantId}`;
  const { items } = list;
  const empty = dueEmptyLine(list, t);
  const leftOut = leftOutLine(list.left_out, t);
  return (
    <section aria-labelledby="due-heading">
      <h1 id="due-heading" className={pageH1}>{t("fu.follow_ups_due")}</h1>
      {tabs}
      <p role="note" className={mutedText}>
        {t("fu.worked_out_when_you_opened_this")}
      </p>
      <p role="note" className={mutedText}>
        {sayText(t, "fu.x", DUE_TEXT.hint)}
      </p>
      {!list.policy_in_force ? (
        <p>{sayText(t, "fu.x", followupSentence(409, "no_followup_policy"))}</p>
      ) : empty !== null ? (
        <p>{empty}</p>
      ) : (
        <ul aria-label={t("fu.leads_with_a_follow_up")}>
          {items.map((i) => (
            <li key={i.lead_id} className={listItemCard}>
              <Link href={`${base}/leads/${i.lead_id}/followup?channel=${i.default_channel}`} className={link}>
                <strong>{i.action === "draft_followup" ? t("fu.due_now") : i.action === "wait" ? t("fu.not_yet") : t("fu.no_follow_up")}</strong>
              </Link>{" "}
              · {dueLine(i, t)}
              {channelsLine(i.channels, i.default_channel, t) !== null ? (
                <>
                  <br />
                  <span className={hintInline}>{channelsLine(i.channels, i.default_channel, t)}</span>
                </>
              ) : null}
              {i.open_draft_id ? (
                <>
                  <br />
                  <span className={hintInline}>
                    {i.open_draft_channel === null
                      ? t("fu.a_draft_is_waiting_open_the")
                      : t("fu.waiting_on_channel", { channel: t(`fu.channel.${i.open_draft_channel}`) })}
                  </span>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {list.policy_in_force && leftOut !== null ? (
        <p role="note" className={mutedText}>
          {leftOut}
        </p>
      ) : null}
      {list.policy_in_force && list.next_cursor !== null ? (
        <p>
          <Link href={`${base}/followups?after=${list.next_cursor}`} className={link}>
            {sayText(t, "fu.x", DUE_TEXT.next)}
          </Link>
        </p>
      ) : null}
    </section>
  );
}
