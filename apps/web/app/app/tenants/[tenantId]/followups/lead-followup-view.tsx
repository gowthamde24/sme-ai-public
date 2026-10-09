import type { ReactNode } from "react";

import Link from "next/link";

import { CHANNEL_LABELS, DISCARD_LABELS, STATUS_LABELS, type Draft, type LeadFollowup } from "@/lib/api/followups";

import { LocalTime } from "../../../local-time";
import { ChannelTabs } from "./channel-tabs";
import { ApproveForm, DiscardForm, SentForm } from "./draft-forms";
import { DraftText } from "./draft-text";
import { approveDraftAction, discardDraftAction, recordSentAction } from "./followup-actions";
import { channelTabs, decisionLine, draftAsk, draftOffers, gateLines } from "./followup-logic";
import { link, listItemCard, mutedText, noteBox, pageH1, pageH2 } from "@/components/v2/app/ui";

export interface LeadFollowupIds {
  /** One touch id per "I sent it myself" form (a retry sends the same one: the database then replays). */
  sentTouchIds: Record<string, string>;
  /** The page's own India date and time now: a time field's `max`, never the future. */
  maxNow: string;
}

function DraftCard({ tenantId, leadId, draft, role, userId, aal, ids }: { tenantId: string; leadId: string; draft: Draft; role: string; userId: string; aal: string; ids: LeadFollowupIds }) {
  const offers = draftOffers(draft, role, userId, aal);
  return (
    <li className={listItemCard}>
      <p>
        <strong>Touch {draft.touch_number}</strong> · {CHANNEL_LABELS[draft.channel]} · {STATUS_LABELS[draft.status]}
        {draft.discard_code ? ` (${DISCARD_LABELS[draft.discard_code]})` : ""}
      </p>
      <p className={mutedText}>
        Made <LocalTime iso={draft.created_at} />
        {draft.approved_at ? (
          <>
            {" "}
            · approved <LocalTime iso={draft.approved_at} />
          </>
        ) : null}
      </p>
      {draft.status === "draft" || draft.status === "approved" ? (
        <>
          <p className={mutedText}>This is the text you review. It is a fixed template: nothing here can be edited.</p>
          <DraftText text={draft.body} />
        </>
      ) : null}
      {offers.approve ? <ApproveForm action={approveDraftAction.bind(null, tenantId, leadId, draft.id)} stateHash={draft.state_hash} secondFactorMissing={offers.approveNeedsSecondFactor} /> : null}
      {offers.sent ? <SentForm action={recordSentAction.bind(null, tenantId, leadId, draft.id)} touchId={ids.sentTouchIds[draft.id]} maxNow={ids.maxNow} /> : null}
      {offers.discard ? <DiscardForm action={discardDraftAction.bind(null, tenantId, leadId, draft.id)} /> : null}
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
  touchForm,
}: {
  tenantId: string;
  leadId: string;
  data: LeadFollowup;
  role: string;
  userId: string;
  aal: string;
  ids: LeadFollowupIds;
  draftForm: ReactNode;
  touchForm: ReactNode;
}) {
  const lines = gateLines(data.gate);
  const ask = draftAsk(data);
  return (
    <section aria-labelledby="followup-heading">
      <h1 id="followup-heading" className={pageH1}>Follow-up</h1>
      <ChannelTabs tenantId={tenantId} leadId={leadId} tabs={channelTabs(data)} />
      <h2 className={pageH2}>Is anything blocking a follow-up?</h2>
      {lines.length === 0 ? (
        <p>Nothing blocks a follow-up for this lead.</p>
      ) : (
        <ul aria-label="What blocks a follow-up">
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}

      {data.gate.stopped === null && data.gate.blocked === null ? (
        <>
          <h2 className={pageH2}>What the rules say now</h2>
          <p role="note" className={mutedText}>
            Guidance only: the database decides again when you ask for a draft.
          </p>
          <p>{decisionLine(data.decision, data.gate.policy_in_force)}</p>
        </>
      ) : null}

      <h2 className={pageH2}>Drafts</h2>
      {data.drafts.length === 0 ? (
        <p>No drafts yet.</p>
      ) : (
        <ul aria-label="Drafts, newest first">
          {data.drafts.map((d) => (
            <DraftCard key={d.id} tenantId={tenantId} leadId={leadId} draft={d} role={role} userId={userId} aal={aal} ids={ids} />
          ))}
        </ul>
      )}

      {ask.waiting ? (
        <p role="note" className={noteBox}>
          A draft for touch {ask.waiting.touch_number} is waiting on {CHANNEL_LABELS[ask.waiting.channel]}. Work on it there, or discard it first: a follow-up has one draft, on one channel.{" "}
          <Link href={`/app/tenants/${tenantId}/leads/${leadId}/followup?channel=${ask.waiting.channel}`} className={link}>Open the {CHANNEL_LABELS[ask.waiting.channel]} tab</Link>
        </p>
      ) : null}
      {ask.show ? draftForm : null}
      {touchForm}

      <h2 className={pageH2}>Touches</h2>
      {data.touches.length === 0 ? (
        <p>Nothing recorded yet. The first message is yours: write it, send it yourself, then record it here.</p>
      ) : (
        <ul aria-label="Touches, newest first">
          {data.touches.map((t) => (
            <li key={t.id}>
              {t.direction === "out" ? "You sent it yourself" : "They replied"} · {CHANNEL_LABELS[t.channel]} · <LocalTime iso={t.occurred_at} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
