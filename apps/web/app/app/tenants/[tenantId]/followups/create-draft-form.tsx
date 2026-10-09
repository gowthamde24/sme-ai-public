"use client";

import { CHANNEL_LABELS, type DraftChannel } from "@/lib/api/followups";

import { ActionResultV2 } from "@/components/v2/app/parts";
import type { FollowupActionState } from "./followup-actions";
import { useFollowupAction } from "./use-followup-action";
import { btnMain, formCardWide, formTitle, mutedText } from "@/components/v2/app/ui";

type Action = (prev: FollowupActionState, formData: FormData) => Promise<FollowupActionState>;

/**
 * Ask for a follow-up DRAFT on the channel of the tab the person is looking at (a fixed, visible channel: there is no select, so the page and the form can never disagree). There is no field for wording,
 * because the text is a fixed template the database makes for this lead's own contact.
 */
export function CreateDraftForm({ action, draftId, channel }: { action: Action; draftId: string; channel: DraftChannel }) {
  const { state, formAction, pending } = useFollowupAction(action);
  return (
    <form action={formAction} className={formCardWide} aria-labelledby="draft-title">
      <h3 id="draft-title" className={formTitle}>
        Ask for a draft
      </h3>
      <p className={mutedText}>The text is a fixed template: you cannot type or change it here. You approve it, copy it, and send it yourself.</p>
      <input type="hidden" name="draft_id" value={draftId} />
      <input type="hidden" name="channel" value={channel} />
      <p>
        Channel: <strong>{CHANNEL_LABELS[channel]}</strong>
      </p>
      <button type="submit" className={btnMain} disabled={pending}>
        {pending ? "Asking..." : "Ask for a draft"}
      </button>
      <ActionResultV2 state={state} />
    </form>
  );
}
