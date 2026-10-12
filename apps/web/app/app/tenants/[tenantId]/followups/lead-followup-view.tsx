import type { ReactNode } from "react";

import Link from "next/link";

import { type Draft, type LeadFollowup } from "@/lib/api/followups";

import { LocalTime } from "../../../local-time";
import { ChannelTabs } from "./channel-tabs";
import { ApproveForm, DiscardForm, SentForm } from "./draft-forms";
import { DraftText } from "./draft-text";
import { approveDraftAction, discardDraftAction, recordSentAction } from "./followup-actions";
import { channelTabs, decisionLine, draftAsk, draftOffers, gateLines } from "./followup-logic";
import { Rich } from "@/components/v2/app/rich";
import { link, listItemCard, mutedText, noteBox, pageH1, pageH2 } from "@/components/v2/app/ui";
import { makeT, type Words } from "@/components/v2/app/words";

export interface LeadFollowupIds {
  /** One touch id per "I sent it myself" form (a retry sends the same one: the database then replays). */
  sentTouchIds: Record<string, string>;
  /** The page's own India date and time now: a time field's `max`, never the future. */
  maxNow: string;
}

function DraftCard({ tenantId, leadId, draft, role, userId, aal, ids, words }: { tenantId: string; leadId: string; draft: Draft; role: string; userId: string; aal: string; ids: LeadFollowupIds; words?: Words; }) {
  const t = makeT(words);
  const offers = draftOffers(draft, role, userId, aal);
  return (
    <li className={listItemCard}>
      <p>
        <strong>{t("fu.touch_n", { n: draft.touch_number })}</strong> · {t(`fu.channel.${draft.channel}`)} · {t(`fu.status.${draft.status}`)}
        {draft.discard_code ? ` (${t(`fu.discard.${draft.discard_code}`)})` : ""}
      </p>
      <p className={mutedText}>
        {draft.approved_at ? (
          <Rich t={t} k="fu.made_approved_line" with={{ time: <LocalTime iso={draft.created_at} />, approved: <LocalTime iso={draft.approved_at} /> }} />
        ) : (
          <Rich t={t} k="fu.made_line" with={{ time: <LocalTime iso={draft.created_at} /> }} />
        )}
      </p>
      {draft.status === "draft" || draft.status === "approved" ? (
        <>
          <p className={mutedText}>{t("fu.this_is_the_text_you_review")}</p>
          <DraftText words={words} text={draft.body} />
        </>
      ) : null}
      {offers.approve ? <ApproveForm words={words} action={approveDraftAction.bind(null, tenantId, leadId, draft.id)} stateHash={draft.state_hash} secondFactorMissing={offers.approveNeedsSecondFactor} /> : null}
      {offers.sent ? <SentForm words={words} action={recordSentAction.bind(null, tenantId, leadId, draft.id)} touchId={ids.sentTouchIds[draft.id]} maxNow={ids.maxNow} /> : null}
      {offers.discard ? <DiscardForm words={words} action={discardDraftAction.bind(null, tenantId, leadId, draft.id)} /> : null}
    </li>
  );
}

/**
 * One lead's follow-up, in plain words: whether anything blocks it (in closed words), what the pinned rules say now (GUIDANCE ONLY: the database decides again when a draft is asked for; a lead the database has STOPPED or the gate BLOCKS has no guidance at all: the line under "Is anything blocking a follow-up?" says it), the drafts
 * with the actions this role may take, and the touches. The page is read for ONE channel (the tab); the tabs say whether each channel is open. The forms (passed in) record what a person did; nothing on this page
 * sends a message to anyone. "Ask for a draft" is offered only on an open tab and only while no draft of this lead is open on the other channel.
 */
export function LeadFollowupView({
  tenantId,
  leadId,
  data,
  role,
  userId,
  aal,
  ids,
  draftForm,
  touchForm, words,
}: {
  tenantId: string;
  leadId: string;
  data: LeadFollowup;
  role: string;
  userId: string;
  aal: string;
  ids: LeadFollowupIds;
  draftForm: ReactNode;
  touchForm: ReactNode; words?: Words;
}) {
  const t = makeT(words);
  const lines = gateLines(data.gate, t);
  const ask = draftAsk(data);
  return (
    <section aria-labelledby="followup-heading">
      <h1 id="followup-heading" className={pageH1}>{t("fu.follow_up")}</h1>
      <ChannelTabs tenantId={tenantId} leadId={leadId} tabs={channelTabs(data, t)} />
      <h2 className={pageH2}>{t("fu.is_anything_blocking_a_follow_up")}</h2>
      {lines.length === 0 ? (
        <p>{t("fu.nothing_blocks_a_follow_up_for")}</p>
      ) : (
        <ul aria-label={t("fu.what_blocks_a_follow_up")}>
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}

      {data.gate.stopped === null && data.gate.blocked === null ? (
        <>
          <h2 className={pageH2}>{t("fu.what_the_rules_say_now")}</h2>
          <p role="note" className={mutedText}>
            {t("fu.guidance_only_the_database_decides_again")}
          </p>
          <p>{decisionLine(data.decision, data.gate.policy_in_force, t)}</p>
        </>
      ) : null}

      <h2 className={pageH2}>{t("fu.drafts")}</h2>
      {data.drafts.length === 0 ? (
        <p>{t("fu.no_drafts_yet")}</p>
      ) : (
        <ul aria-label={t("fu.drafts_newest_first")}>
          {data.drafts.map((d) => (
            <DraftCard words={words} key={d.id} tenantId={tenantId} leadId={leadId} draft={d} role={role} userId={userId} aal={aal} ids={ids} />
          ))}
        </ul>
      )}

      {ask.waiting ? (
        <p role="note" className={noteBox}>
          {t("fu.waiting_note", { n: ask.waiting.touch_number, channel: t(`fu.channel.${ask.waiting.channel}`) })}{" "}
          <Link href={`/app/tenants/${tenantId}/leads/${leadId}/followup?channel=${ask.waiting.channel}`} className={link}>{t("fu.open_tab", { channel: t(`fu.channel.${ask.waiting.channel}`) })}</Link>
        </p>
      ) : null}
      {ask.show ? draftForm : null}
      {touchForm}

      <h2 className={pageH2}>{t("fu.touches")}</h2>
      {data.touches.length === 0 ? (
        <p>{t("fu.nothing_recorded_yet_the_first_message")}</p>
      ) : (
        <ul aria-label={t("fu.touches_newest_first")}>
          {data.touches.map((touch) => (
            <li key={touch.id}>
              {touch.direction === "out" ? t("fu.you_sent_it_yourself") : t("fu.they_replied")} · {t(`fu.channel.${touch.channel}`)} · <LocalTime iso={touch.occurred_at} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
