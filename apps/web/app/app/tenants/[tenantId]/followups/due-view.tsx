import type { ReactNode } from "react";
import Link from "next/link";

import { DUE_TEXT, followupSentence } from "@/lib/api/followup-text";
import { CHANNEL_LABELS, type DueList } from "@/lib/api/followups";

import { channelsLine, dueEmptyLine, dueLine, leftOutLine } from "./followup-logic";
import { hintInline, link, listItemCard, mutedText, pageH1 } from "@/components/v2/app/ui";

/**
 * The leads with a recorded first message, each put to the pinned rules when this page was opened (there is no scheduler and nothing runs in the background). It is GUIDANCE: opening a lead and
 * asking for a draft makes the database decide again. One row per LEAD: it names the state of each channel (when the API reported them) and the row opens the lead on the channel to start with. The list is one PAGE,
 * oldest last message first; leads that need no follow-up are not listed; a link goes to the next page; a note says how many candidates of this page could not be shown. Nothing here sends a message.
 */
export function DueView({ tenantId, list, tabs = null }: { tenantId: string; list: DueList; tabs?: ReactNode }) {
  const base = `/app/tenants/${tenantId}`;
  const { items } = list;
  const empty = dueEmptyLine(list);
  const leftOut = leftOutLine(list.left_out);
  return (
    <section aria-labelledby="due-heading">
      <h1 id="due-heading" className={pageH1}>Follow-ups due</h1>
      {tabs}
      <p role="note" className={mutedText}>
        Worked out when you opened this page. Guidance only: the database decides again when you ask for a draft.
      </p>
      <p role="note" className={mutedText}>
        {DUE_TEXT.hint}
      </p>
      {!list.policy_in_force ? (
        <p>{followupSentence(409, "no_followup_policy")}</p>
      ) : empty !== null ? (
        <p>{empty}</p>
      ) : (
        <ul aria-label="Leads with a follow-up">
          {items.map((i) => (
            <li key={i.lead_id} className={listItemCard}>
              <Link href={`${base}/leads/${i.lead_id}/followup?channel=${i.default_channel}`} className={link}>
                <strong>{i.action === "draft_followup" ? "Due now" : i.action === "wait" ? "Not yet" : "No follow-up"}</strong>
              </Link>{" "}
              · {dueLine(i)}
              {channelsLine(i.channels, i.default_channel) !== null ? (
                <>
                  <br />
                  <span className={hintInline}>{channelsLine(i.channels, i.default_channel)}</span>
                </>
              ) : null}
              {i.open_draft_id ? (
                <>
                  <br />
                  <span className={hintInline}>
                    {i.open_draft_channel === null
                      ? "A draft is waiting: open the lead to read and approve it."
                      : `A draft is waiting on ${CHANNEL_LABELS[i.open_draft_channel]}: open the lead to read and approve it.`}
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
            {DUE_TEXT.next}
          </Link>
        </p>
      ) : null}
    </section>
  );
}
