"use client";

import { useActionState, useState } from "react";

import { BASES, BASIS_LABELS, CHANNELS, CHANNEL_LABELS, EVIDENCE_KINDS, EVIDENCE_LABELS, STATUS_LABELS } from "@/lib/api/consent";

import { LocalTime } from "../../../../../local-time";
import type { ConsentFormState } from "./actions";

type Action = (prev: ConsentFormState, formData: FormData) => Promise<ConsentFormState>;

/**
 * One consent entry. It writes down what the person says and does not check it. After a press it says who recorded it (the signed-in person) and when (the moment this screen sent it), and shows the
 * three states the API holds now. No word here says the entry is valid, lawful or enough, and no number or address is shown.
 */
export function ConsentForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const [status, setStatus] = useState<"granted" | "withdrawn">("granted");
  return (
    <form action={formAction} className="card" style={{ maxWidth: "40rem" }} aria-label="Record consent">
      <label htmlFor="consent-channel">Channel</label>
      <select id="consent-channel" name="channel" defaultValue="whatsapp" disabled={pending}>
        {CHANNELS.map((c) => (
          <option key={c} value={c}>
            {CHANNEL_LABELS[c]}
          </option>
        ))}
      </select>
      <fieldset disabled={pending} style={{ border: 0, padding: 0, margin: 0 }}>
        <legend>What are you writing down?</legend>
        <label>
          <input type="radio" name="status" value="granted" checked={status === "granted"} onChange={() => setStatus("granted")} /> {STATUS_LABELS.granted}
        </label>
        <label>
          <input type="radio" name="status" value="withdrawn" checked={status === "withdrawn"} onChange={() => setStatus("withdrawn")} /> {STATUS_LABELS.withdrawn}
        </label>
      </fieldset>
      {status === "granted" && (
        <>
          <label htmlFor="consent-basis">Basis, as you describe it</label>
          <select id="consent-basis" name="basis" defaultValue="explicit_consent" disabled={pending}>
            {BASES.map((b) => (
              <option key={b} value={b}>
                {BASIS_LABELS[b]}
              </option>
            ))}
          </select>
          <label htmlFor="consent-kind">Kind of evidence</label>
          <select id="consent-kind" name="evidence_kind" defaultValue="verbal" disabled={pending}>
            {EVIDENCE_KINDS.map((k) => (
              <option key={k} value={k}>
                {EVIDENCE_LABELS[k]}
              </option>
            ))}
          </select>
          <label htmlFor="consent-label">A short label for your note</label>
          <input id="consent-label" name="evidence_label" required maxLength={96} autoComplete="off" placeholder="call-2026-10-08" pattern="[A-Za-z0-9._#/\-]{1,96}" disabled={pending} />
          <p className="hint">Letters, digits and . _ # / - only. No names, numbers or addresses: it is only a label so you can find your own note later.</p>
        </>
      )}
      <p className="hint">This only writes down what you tell us. It does not check it, and it is not legal advice. If you are not sure, leave it as it is.</p>
      {state?.error && (
        <p role="alert" className="error">
          {state.error}
        </p>
      )}
      {state?.ok && state.channel && state.status && state.at && state.consents && (
        <div role="status" className="hint">
          <p>
            Recorded: {CHANNEL_LABELS[state.channel]}, {STATUS_LABELS[state.status].toLowerCase()}. Recorded by {state.by} at <LocalTime iso={state.at} /> (the time this screen sent it). The system keeps it in the consent history.
          </p>
          <p>
            Now: {CHANNELS.map((c) => `${CHANNEL_LABELS[c]} ${STATUS_LABELS[state.consents![c]].toLowerCase()}`).join(" · ")}.
          </p>
        </div>
      )}
      <button type="submit" disabled={pending}>
        {pending ? "Saving..." : "Record this"}
      </button>
    </form>
  );
}
