"use client";

import { type DraftChannel } from "@/lib/api/followups";

import { ActionResultV2 } from "@/components/v2/app/parts";
import type { FollowupActionState } from "./followup-actions";
import { useFollowupAction } from "./use-followup-action";
import { btnMain, formCardWide, formTitle, mutedText } from "@/components/v2/app/ui";
import { Rich } from "@/components/v2/app/rich";
import { makeT, type Words } from "@/components/v2/app/words";

type Action = (prev: FollowupActionState, formData: FormData) => Promise<FollowupActionState>;

/**
 * Ask for a follow-up DRAFT on the channel of the tab the person is looking at (a fixed, visible channel: there is no select, so the page and the form can never disagree). There is no field for wording,
 * because the text is a fixed template the database makes for this lead's own contact.
 */
export function CreateDraftForm({ action, draftId, channel, words }: { action: Action; draftId: string; channel: DraftChannel; words?: Words; }) {
  const t = makeT(words);
  const { state, formAction, pending } = useFollowupAction(action);
  return (
    <form action={formAction} className={formCardWide} aria-labelledby="draft-title">
      <h3 id="draft-title" className={formTitle}>
        {t("fu.ask_for_a_draft")}
      </h3>
      <p className={mutedText}>{t("fu.the_text_is_a_fixed_template")}</p>
      <input type="hidden" name="draft_id" value={draftId} />
      <input type="hidden" name="channel" value={channel} />
      <p>
        <Rich t={t} k="fu.channel_line" with={{ channel: <strong>{t(`fu.channel.${channel}`)}</strong> }} />
      </p>
      <button type="submit" className={btnMain} disabled={pending}>
        {pending ? t("fu.asking") : t("fu.ask_for_a_draft")}
      </button>
      <ActionResultV2 state={state} />
    </form>
  );
}
