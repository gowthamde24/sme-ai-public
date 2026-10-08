"use client";

import { startTransition, useActionState, useState } from "react";

import { BASES, BASIS_LABELS, CHANNELS, CHANNEL_LABELS, EVIDENCE_KINDS, EVIDENCE_LABELS, STATUS_LABELS } from "@/lib/api/consent";

import { LocalTime } from "../../../../../local-time";
import type { ConsentFormState } from "./actions";

type Action = (prev: ConsentFormState, formData: FormData) => Promise<ConsentFormState>;

/**
 * One consent entry. It writes down what the person says and does not check it. After a press it says who recorded it (the signed-in person) and when (the moment this screen sent it), and shows the
 * three states the API holds now. No word here says the entry is valid, lawful or enough, and no number or address is shown.
 */
export function ConsentForm({ action }: { action: Action }) {
  // NOTHING is pre-selected: the person must choose the channel, the status and, for "granted", the basis and the kind of evidence. Pressing Save cannot record anything they did not choose.
  // Every choice is held in state and the form is submitted through onSubmit, not through an `action` prop (React resets the fields of an `action` form when it finishes): a failed submit keeps exactly
  // what the person chose, and a saved entry returns the form to "nothing chosen". The browser's own validation still runs first, so a missing required choice never reaches the action.
  const [status, setStatus] = useState<"granted" | "withdrawn" | "">("");
  const [channel, setChannel] = useState("");
  const [basis, setBasis] = useState("");
  const [kind, setKind] = useState("");
  const [label, setLabel] = useState("");
  const [state, formAction, pending] = useActionState(async (prev: ConsentFormState, formData: FormData) => {
    const next = await action(prev, formData);
    if (next?.ok) {
      setChannel("");
      setStatus("");
      setBasis("");
      setKind("");
      setLabel("");
    }
    return next;
  }, undefined);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => formAction(data));
      }}
      className="card" style={{ maxWidth: "40rem" }} aria-label="Record consent">
      <label htmlFor="consent-channel">Channel</label>
      <select id="consent-channel" name="channel" required value={channel} onChange={(e) => setChannel(e.target.value)} disabled={pending}>
        <option value="" disabled>
          Choose one
        </option>
        {CHANNELS.map((c) => (
          <option key={c} value={c}>
            {CHANNEL_LABELS[c]}
          </option>
        ))}
      </select>
      <fieldset disabled={pending} style={{ border: 0, padding: 0, margin: 0 }}>
        <legend>What are you writing down?</legend>
        <label>
          <input type="radio" name="status" value="granted" required checked={status === "granted"} onChange={() => setStatus("granted")} /> {STATUS_LABELS.granted}
        </label>
        <label>
          <input type="radio" name="status" value="withdrawn" required checked={status === "withdrawn"} onChange={() => setStatus("withdrawn")} /> {STATUS_LABELS.withdrawn}
        </label>
      </fieldset>
      {status === "granted" && (
        <>
          <label htmlFor="consent-basis">Basis, as you describe it</label>
          <select id="consent-basis" name="basis" required value={basis} onChange={(e) => setBasis(e.target.value)} disabled={pending}>
            <option value="" disabled>
              Choose one
            </option>
            {BASES.map((b) => (
              <option key={b} value={b}>
                {BASIS_LABELS[b]}
              </option>
            ))}
          </select>
          <label htmlFor="consent-kind">Kind of evidence</label>
          <select id="consent-kind" name="evidence_kind" required value={kind} onChange={(e) => setKind(e.target.value)} disabled={pending}>
            <option value="" disabled>
              Choose one
            </option>
            {EVIDENCE_KINDS.map((k) => (
              <option key={k} value={k}>
                {EVIDENCE_LABELS[k]}
              </option>
            ))}
          </select>
          <label htmlFor="consent-label">A short label for your note</label>
          <input id="consent-label" name="evidence_label" required value={label} onChange={(e) => setLabel(e.target.value)} maxLength={96} autoComplete="off" placeholder="call-2026-10-08" pattern="[A-Za-z0-9._#/\-]{1,96}" disabled={pending} />
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
