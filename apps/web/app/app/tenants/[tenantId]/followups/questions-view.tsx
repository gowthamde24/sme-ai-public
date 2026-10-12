import type { ReactNode } from "react";

import { type QuestionDraft } from "@/lib/api/followups";

import { DraftText } from "./draft-text";
import { decideQuestionAction } from "./followup-actions";
import { QuestionButton } from "./question-forms";
import { listItemCard, pageH1 } from "@/components/v2/app/ui";
import { makeT, type Words } from "@/components/v2/app/words";

/**
 * The stored clarifying questions of a requirement. Each is a fixed template that echoes closed values only; a person approves it, copies it and asks the customer themselves. Nothing here
 * sends anything, and there is no field for wording.
 */
export function QuestionsView({ tenantId, requirementId, drafts, sync, words }: { tenantId: string; requirementId: string; drafts: QuestionDraft[]; sync: ReactNode; words?: Words; }) {
  const t = makeT(words);
  return (
    <section aria-labelledby="questions-heading">
      <h1 id="questions-heading" className={pageH1}>{t("fu.questions_for_the_customer")}</h1>
      {sync}
      {drafts.length === 0 ? (
        <p>{t("fu.no_questions_stored_update_them_from")}</p>
      ) : (
        <ul aria-label={t("fu.questions")}>
          {drafts.map((q) => (
            <li key={q.id} className={listItemCard}>
              <p>
                <strong>{t(`fu.qstatus.${q.status}`)}</strong>
                {q.line_no > 0 ? ` · item ${q.line_no}` : ""}
                {q.discard_code ? ` (${t(`fu.qdiscard.${q.discard_code}`)})` : ""}
              </p>
              {q.status !== "discarded" ? <DraftText words={words} text={q.question_text} /> : null}
              {q.status === "draft" ? <QuestionButton words={words} action={decideQuestionAction.bind(null, tenantId, requirementId, q.id, "approve")} label={t("fu.approve_this_question")} /> : null}
              {q.status !== "discarded" ? <QuestionButton words={words} action={decideQuestionAction.bind(null, tenantId, requirementId, q.id, "discard")} label={t("fu.discard_this_question")} quiet /> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
