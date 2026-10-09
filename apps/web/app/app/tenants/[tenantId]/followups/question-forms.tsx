"use client";

import { ActionResultV2 } from "@/components/v2/app/parts";
import type { FollowupActionState } from "./followup-actions";
import { useFollowupAction } from "./use-followup-action";
import { btnMain, btnQuiet } from "@/components/v2/app/ui";

type Action = (prev: FollowupActionState, formData: FormData) => Promise<FollowupActionState>;

/** Store the clarifying questions the fixed templates derive from the requirement now. Nothing is sent: a person approves a question, then copies it and asks the customer themselves. */
export function SyncQuestionsForm({ action }: { action: Action }) {
  const { state, formAction, pending } = useFollowupAction(action);
  return (
    <form action={formAction} aria-label="Update the questions from the requirement">
      <button type="submit" className={btnMain} disabled={pending}>
        {pending ? "Updating..." : "Update the questions from the requirement"}
      </button>
      <ActionResultV2 state={state} />
    </form>
  );
}

export function QuestionButton({ action, label, quiet }: { action: Action; label: string; quiet?: boolean }) {
  const { state, formAction, pending } = useFollowupAction(action);
  return (
    <form action={formAction} aria-label={label}>
      <button type="submit" className={quiet ? btnQuiet : btnMain} disabled={pending}>
        {pending ? "Saving..." : label}
      </button>
      <ActionResultV2 state={state} />
    </form>
  );
}
