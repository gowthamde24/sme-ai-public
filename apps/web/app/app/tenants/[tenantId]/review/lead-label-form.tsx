"use client";

import { useActionState, useState } from "react";

import {
  LEAD_LABEL_REASON_LABELS,
  LEAD_LABEL_REASONS,
  type LeadLabel,
  type LeadLabelReason,
} from "@/lib/api/leads";

import { labelLeadAction, type LabelActionState } from "./actions";

interface LeadLabelFormProps {
  tenantId: string;
  leadId: string;
  currentLabel?: LeadLabel | null;
  currentReason?: LeadLabelReason | null;
}

export function LeadLabelForm({
  tenantId,
  leadId,
  currentLabel,
  currentReason,
}: LeadLabelFormProps) {
  const [selectedLabel, setSelectedLabel] = useState<LeadLabel | "">("");
  const [reasonCode, setReasonCode] = useState<string>(currentReason || LEAD_LABEL_REASONS[0]);

  const boundAction = labelLeadAction.bind(null, tenantId, leadId);
  const [state, formAction, isPending] = useActionState<LabelActionState, FormData>(
    boundAction,
    {},
  );

  return (
    <form action={formAction} className="review-actions">
      <input type="hidden" name="label" value={selectedLabel} />

      {selectedLabel === "bad" && (
        <div className="row" style={{ marginRight: "0.5rem" }}>
          <label htmlFor={`reason-${leadId}`} className="hint">
            Reason:
          </label>
          <select
            id={`reason-${leadId}`}
            name="reason_code"
            value={reasonCode}
            onChange={(e) => setReasonCode(e.target.value)}
            disabled={isPending}
            required
          >
            {LEAD_LABEL_REASONS.map((reason) => (
              <option key={reason} value={reason}>
                {LEAD_LABEL_REASON_LABELS[reason]}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="row">
        <button
          type="submit"
          className="button-good"
          disabled={isPending}
          onClick={() => setSelectedLabel("good")}
          aria-pressed={currentLabel === "good"}
        >
          {isPending && selectedLabel === "good" ? "Saving..." : "Good"}
        </button>

        <button
          type="submit"
          className="button-maybe"
          disabled={isPending}
          onClick={() => setSelectedLabel("maybe")}
          aria-pressed={currentLabel === "maybe"}
        >
          {isPending && selectedLabel === "maybe" ? "Saving..." : "Maybe"}
        </button>

        {selectedLabel !== "bad" ? (
          <button
            type="button"
            className="button-bad"
            disabled={isPending}
            onClick={() => setSelectedLabel("bad")}
            aria-pressed={currentLabel === "bad"}
          >
            Bad...
          </button>
        ) : (
          <button
            type="submit"
            className="button-bad"
            disabled={isPending}
          >
            {isPending ? "Saving..." : "Confirm Bad"}
          </button>
        )}

        {selectedLabel === "bad" && (
          <button
            type="button"
            className="secondary"
            disabled={isPending}
            onClick={() => setSelectedLabel("")}
          >
            Cancel
          </button>
        )}
      </div>

      {state?.error && (
        <p role="alert" className="error hint">
          {state.error}
        </p>
      )}
      {state?.ok && state?.message && (
        <p role="status" className="hint" style={{ color: "#16a34a" }}>
          {state.message}
        </p>
      )}
    </form>
  );
}
