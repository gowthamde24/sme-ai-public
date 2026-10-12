"use client";

import { startTransition, useActionState, useState } from "react";

import { BASES, CHANNELS, EVIDENCE_KINDS } from "@/lib/api/consent";

import { LocalTime } from "../../../../../local-time";
import type { ConsentFormState } from "./actions";
import { alertBox, btnMain, fieldInput, fieldLabel, fieldsetPlain, formCardWide, legendText, mutedText, okBox, radioRow } from "@/components/v2/app/ui";
import { Rich } from "@/components/v2/app/rich";
import { makeT, type Words } from "@/components/v2/app/words";

type Action = (prev: ConsentFormState, formData: FormData) => Promise<ConsentFormState>;

/**
 * One consent entry. It writes down what the person says and does not check it. After a press it says who recorded it (the signed-in person) and when (the moment this screen sent it), and shows the
 * three states the API holds now. No word here says the entry is valid, lawful or enough, and no number or address is shown.
 */
export function ConsentForm({ action, words }: { action: Action; words?: Words; }) {
  const t = makeT(words);
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
      className={formCardWide} aria-label={t("cont.record_consent")}>
      <label htmlFor="consent-channel" className={fieldLabel}>
        {t("cont.channel")}
      </label>
      <select id="consent-channel" name="channel" required value={channel} onChange={(e) => setChannel(e.target.value)} disabled={pending} className={fieldInput}>
        <option value="" disabled>
          {t("cont.choose_one")}
        </option>
        {CHANNELS.map((c) => (
          <option key={c} value={c}>
            {t(`cont.channel.${c}`)}
          </option>
        ))}
      </select>
      <fieldset disabled={pending} className={fieldsetPlain}>
        <legend className={legendText}>{t("cont.what_are_you_writing_down")}</legend>
        <label className={radioRow}>
          <input type="radio" name="status" value="granted" required checked={status === "granted"} onChange={() => setStatus("granted")} /> {t("cont.status.granted")}
        </label>
        <label className={radioRow}>
          <input type="radio" name="status" value="withdrawn" required checked={status === "withdrawn"} onChange={() => setStatus("withdrawn")} /> {t("cont.status.withdrawn")}
        </label>
      </fieldset>
      {status === "granted" && (
        <>
          <label htmlFor="consent-basis" className={fieldLabel}>
        {t("cont.basis_as_you_describe_it")}
      </label>
          <select id="consent-basis" name="basis" required value={basis} onChange={(e) => setBasis(e.target.value)} disabled={pending} className={fieldInput}>
            <option value="" disabled>
              {t("cont.choose_one")}
            </option>
            {BASES.map((b) => (
              <option key={b} value={b}>
                {t(`cont.basis.${b}`)}
              </option>
            ))}
          </select>
          <label htmlFor="consent-kind" className={fieldLabel}>
        {t("cont.kind_of_evidence")}
      </label>
          <select id="consent-kind" name="evidence_kind" required value={kind} onChange={(e) => setKind(e.target.value)} disabled={pending} className={fieldInput}>
            <option value="" disabled>
              {t("cont.choose_one")}
            </option>
            {EVIDENCE_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`cont.evidence.${k}`)}
              </option>
            ))}
          </select>
          <label htmlFor="consent-label" className={fieldLabel}>
        {t("cont.a_short_label_for_your_note")}
      </label>
          <input id="consent-label" name="evidence_label" required value={label} onChange={(e) => setLabel(e.target.value)} maxLength={96} autoComplete="off" placeholder="call-2026-10-08" pattern="[A-Za-z0-9._#/\-]{1,96}" disabled={pending} className={fieldInput} />
          <p className={mutedText}>{t("cont.letters_digits_and_only_no_names")}</p>
        </>
      )}
      <p className={mutedText}>{t("cont.this_only_writes_down_what_you")}</p>
      {state?.error && (
        <p role="alert" className={alertBox}>
          {state.error}
        </p>
      )}
      {state?.ok && state.channel && state.status && state.at && state.consents && (
        <div role="status" className={okBox}>
          <p>
            <Rich t={t} k="cont.recorded_line" vars={{ channel: t(`cont.channel.${state.channel}`), status: t(`cont.status.${state.status}`).toLowerCase(), by: state.by ?? "" }} with={{ time: <LocalTime iso={state.at} /> }} />
          </p>
          <p>
            {t("cont.now_line", { list: CHANNELS.map((c) => `${t(`cont.channel.${c}`)} ${t(`cont.status.${state.consents![c]}`).toLowerCase()}`).join(" · ") })}
          </p>
        </div>
      )}
      <button type="submit" className={btnMain} disabled={pending}>
        {pending ? t("cont.saving") : t("cont.record_this")}
      </button>
    </form>
  );
}
