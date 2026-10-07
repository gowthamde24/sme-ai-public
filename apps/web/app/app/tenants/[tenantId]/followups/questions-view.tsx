import type { ReactNode } from "react";

import { QUESTION_DISCARD_LABELS, QUESTION_STATUS_LABELS, type QuestionDraft } from "@/lib/api/followups";

import { DraftText } from "./draft-text";
import { decideQuestionAction } from "./followup-actions";
import { QuestionButton } from "./question-forms";

/**
 * The stored clarifying questions of a requirement. Each is a fixed template that echoes closed values only; a person approves it, copies it and asks the customer themselves. Nothing here
 * sends anything, and there is no field for wording.
 */
export function QuestionsView({ tenantId, requirementId, drafts, sync }: { tenantId: string; requirementId: string; drafts: QuestionDraft[]; sync: ReactNode }) {
  return (
    <section aria-labelledby="questions-heading">
      <h1 id="questions-heading">Questions for the customer</h1>
      {sync}
      {drafts.length === 0 ? (
        <p>No questions stored. Update them from the requirement.</p>
      ) : (
        <ul aria-label="Questions">
          {drafts.map((q) => (
            <li key={q.id} className="card">
              <p style={{ margin: 0 }}>
                <strong>{QUESTION_STATUS_LABELS[q.status]}</strong>
                {q.line_no > 0 ? ` · item ${q.line_no}` : ""}
                {q.discard_code ? ` (${QUESTION_DISCARD_LABELS[q.discard_code]})` : ""}
              </p>
              {q.status !== "discarded" ? <DraftText text={q.question_text} /> : null}
              {q.status === "draft" ? <QuestionButton action={decideQuestionAction.bind(null, tenantId, requirementId, q.id, "approve")} label="Approve this question" /> : null}
              {q.status !== "discarded" ? <QuestionButton action={decideQuestionAction.bind(null, tenantId, requirementId, q.id, "discard")} label="Discard this question" quiet /> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
