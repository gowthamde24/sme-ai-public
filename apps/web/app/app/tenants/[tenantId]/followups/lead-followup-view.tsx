import type { ReactNode } from "react";

import { CHANNEL_LABELS, DISCARD_LABELS, STATUS_LABELS, type Draft, type LeadFollowup } from "@/lib/api/followups";

import { LocalTime } from "../../../local-time";
import { ApproveForm, DiscardForm, SentForm } from "./draft-forms";
import { DraftText } from "./draft-text";
import { approveDraftAction, discardDraftAction, recordSentAction } from "./followup-actions";
import { decisionLine, draftOffers, gateLines } from "./followup-logic";

export interface LeadFollowupIds {
  /** One touch id per "I sent it myself" form (a retry sends the same one: the database then replays). */
  sentTouchIds: Record<string, string>;
  /** The page's own India date and time now: a time field's `max`, never the future. */
  maxNow: string;
}

function DraftCard({ tenantId, leadId, draft, role, userId, aal, ids }: { tenantId: string; leadId: string; draft: Draft; role: string; userId: string; aal: string; ids: LeadFollowupIds }) {
  const offers = draftOffers(draft, role, userId, aal);
  return (
    <li className="card">
      <p style={{ margin: 0 }}>
        <strong>Touch {draft.touch_number}</strong> · {CHANNEL_LABELS[draft.channel]} · {STATUS_LABELS[draft.status]}
        {draft.discard_code ? ` (${DISCARD_LABELS[draft.discard_code]})` : ""}
      </p>
      <p className="hint" style={{ margin: 0 }}>
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
          <p className="hint">This is the text you review. It is a fixed template: nothing here can be edited.</p>
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
 * One lead's follow-up, in plain words: whether anything blocks it (in closed words), what the pinned rules say now (GUIDANCE ONLY: the database decides again when a draft is asked for; a lead the database has STOPPED has no guidance at all: the stop line says it), the drafts
 * with the actions this role may take, and the touches. The forms (passed in) record what a person did; nothing on this page sends a message to anyone.
 */
export function LeadFollowupView({
  tenantId,
  leadId,
  data,
  role,
  userId,
  aal,
  ids,
  forms,
}: {
  tenantId: string;
  leadId: string;
  data: LeadFollowup;
  role: string;
  userId: string;
  aal: string;
  ids: LeadFollowupIds;
  forms: ReactNode;
}) {
  const lines = gateLines(data.gate);
  return (
    <section aria-labelledby="followup-heading">
      <h1 id="followup-heading">Follow-up</h1>
      <h2>Is anything blocking a follow-up?</h2>
      {lines.length === 0 ? (
        <p>Nothing blocks a follow-up for this lead.</p>
      ) : (
        <ul aria-label="What blocks a follow-up">
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}

      {data.gate.stopped === null ? (
        <>
          <h2>What the rules say now</h2>
          <p role="note" className="hint">
            Guidance only: the database decides again when you ask for a draft.
          </p>
          <p>{decisionLine(data.decision, data.gate.policy_in_force)}</p>
        </>
      ) : null}

      <h2>Drafts</h2>
      {data.drafts.length === 0 ? (
        <p>No drafts yet.</p>
      ) : (
        <ul aria-label="Drafts, newest first">
          {data.drafts.map((d) => (
            <DraftCard key={d.id} tenantId={tenantId} leadId={leadId} draft={d} role={role} userId={userId} aal={aal} ids={ids} />
          ))}
        </ul>
      )}

      {forms}

      <h2>Touches</h2>
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
