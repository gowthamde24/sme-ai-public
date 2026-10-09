"use client";

import { useActionState } from "react";

import type { EnquiryActionState } from "./actions";
import { ActionResultV2 } from "@/components/v2/app/parts";
import { btnMain, formCol, mutedText } from "@/components/v2/app/ui";

type Action = (prev: EnquiryActionState, formData: FormData) => Promise<EnquiryActionState>;

/** Start a requirement run on this enquiry. The run id comes from the page (one per render): a double click starts one run. */
export function ExtractForm({ action, runId, replaces }: { action: Action; runId: string; replaces: boolean }) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className={formCol}>
      <input type="hidden" name="run_id" value={runId} />
      <button type="submit" className={btnMain} disabled={pending}>
        {pending ? "Starting..." : replaces ? "Suggest the fields again" : "Suggest the fields"}
      </button>
      <p className={mutedText}>
        An assistant reads the text and suggests the fields, each with the words it relies on. Every suggestion stays &quot;Suggested&quot; until a person
        approves, corrects or rejects it.{replaces ? " A new run replaces the draft's suggestions." : ""}
      </p>
      <ActionResultV2 state={state} />
    </form>
  );
}
