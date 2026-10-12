"use client";

import { useActionState } from "react";

import type { EnquiryActionState } from "./actions";
import { ActionResultV2 } from "@/components/v2/app/parts";
import { btnMain, formCol, mutedText } from "@/components/v2/app/ui";
import { makeT, type Words } from "@/components/v2/app/words";

type Action = (prev: EnquiryActionState, formData: FormData) => Promise<EnquiryActionState>;

/** Start a requirement run on this enquiry. The run id comes from the page (one per render): a double click starts one run. */
export function ExtractForm({ action, runId, replaces, words }: { action: Action; runId: string; replaces: boolean; words?: Words; }) {
  const t = makeT(words);
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className={formCol}>
      <input type="hidden" name="run_id" value={runId} />
      <button type="submit" className={btnMain} disabled={pending}>
        {pending ? t("enq.starting") : replaces ? t("enq.suggest_the_fields_again") : t("enq.suggest_the_fields")}
      </button>
      <p className={mutedText}>
        {t("enq.extract_note")}{replaces ? ` ${t("enq.extract_replaces")}` : ""}
      </p>
      <ActionResultV2 state={state} />
    </form>
  );
}
