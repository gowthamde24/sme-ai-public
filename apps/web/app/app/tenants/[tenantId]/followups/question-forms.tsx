"use client";

import { ActionResultV2 } from "@/components/v2/app/parts";
import type { FollowupActionState } from "./followup-actions";
import { useFollowupAction } from "./use-followup-action";
import { btnMain, btnQuiet } from "@/components/v2/app/ui";
import { makeT, type Words } from "@/components/v2/app/words";

type Action = (prev: FollowupActionState, formData: FormData) => Promise<FollowupActionState>;

/** Store the clarifying questions the fixed templates derive from the requirement now. Nothing is sent: a person approves a question, then copies it and asks the customer themselves. */
export function SyncQuestionsForm({ action, words }: { action: Action; words?: Words; }) {
  const t = makeT(words);
  const { state, formAction, pending } = useFollowupAction(action);
  return (
    <form action={formAction} aria-label={t("fu.update_the_questions_from_the_requirement")}>
      <button type="submit" className={btnMain} disabled={pending}>
        {pending ? t("fu.updating") : t("fu.update_the_questions_from_the_requirement")}
      </button>
      <ActionResultV2 state={state} />
    </form>
  );
}

export function QuestionButton({ action, label, quiet, words }: { action: Action; label: string; quiet?: boolean; words?: Words; }) {
  const t = makeT(words);
  const { state, formAction, pending } = useFollowupAction(action);
  return (
    <form action={formAction} aria-label={label}>
      <button type="submit" className={quiet ? btnQuiet : btnMain} disabled={pending}>
        {pending ? t("fu.saving") : label}
      </button>
      <ActionResultV2 state={state} />
    </form>
  );
}
