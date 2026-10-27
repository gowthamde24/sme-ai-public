"use client";

import * as React from "react";

import { consentOf, type ConsentState } from "@/lib/lead-desk/imports/consent";
import { BASES, type Basis } from "@/lib/lead-desk/imports/types";

import { checkBox, checkRow, fieldHelp, fieldInput, fieldLabel, fieldsetLine, formGrid, legendText, warnBox } from "../ui";
import { makeT, type Words } from "../words";

/**
 * The consent confirmation (night 4, Lead Desk): ONE tick box and the four facts (the name of the list, what you will contact them about, why you may, how you got the numbers). It is the owner's own word, so only the
 * Owner and an Admin see the box; a Sales member sees why nothing is sent to the leads they add. Used by the import screen and when a live source is made.
 */
export function ConsentFacts({ words, state, onChange, canConfirm, idPrefix, hint }: { words: Words; state: ConsentState; onChange: (next: ConsentState) => void; canConfirm: boolean; idPrefix: string; hint?: string }) {
  const t = makeT(words);
  if (!canConfirm) {
    return (
      <fieldset className={fieldsetLine}>
        <legend className={legendText}>{t("li.consent.title")}</legend>
        <p role="note" className="text-base">
          {t("li.consent.sales")}
        </p>
      </fieldset>
    );
  }
  const set = (patch: Partial<ConsentState>) => onChange({ ...state, ...patch });
  const incomplete = state.on && consentOf(state) === "incomplete";
  return (
    <fieldset className={fieldsetLine}>
      <legend className={legendText}>{t("li.consent.title")}</legend>
      {hint ? <p className={fieldHelp}>{hint}</p> : null}
      <label htmlFor={`${idPrefix}-on`} className={checkRow}>
        <input id={`${idPrefix}-on`} type="checkbox" className={checkBox} checked={state.on} onChange={(e) => set({ on: e.target.checked })} />
        {t("li.consent.check")}
      </label>
      {state.on ? (
        <div className={formGrid}>
          <div>
            <label htmlFor={`${idPrefix}-list`} className={fieldLabel}>
              {t("li.consent.list_name")}
            </label>
            <input id={`${idPrefix}-list`} className={fieldInput} maxLength={120} value={state.list_name} onChange={(e) => set({ list_name: e.target.value })} />
          </div>
          <div>
            <label htmlFor={`${idPrefix}-purpose`} className={fieldLabel}>
              {t("li.consent.purpose")}
            </label>
            <input id={`${idPrefix}-purpose`} className={fieldInput} maxLength={300} value={state.purpose} onChange={(e) => set({ purpose: e.target.value })} />
          </div>
          <div>
            <label htmlFor={`${idPrefix}-basis`} className={fieldLabel}>
              {t("li.consent.basis")}
            </label>
            <select id={`${idPrefix}-basis`} className={fieldInput} value={state.basis} onChange={(e) => set({ basis: e.target.value as Basis })}>
              {BASES.map((b) => (
                <option key={b} value={b}>
                  {t(`li.consent.basis.${b}`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${idPrefix}-how`} className={fieldLabel}>
              {t("li.consent.how")}
            </label>
            <input id={`${idPrefix}-how`} className={fieldInput} maxLength={300} value={state.how_collected} onChange={(e) => set({ how_collected: e.target.value })} />
          </div>
        </div>
      ) : null}
      {incomplete ? (
        <p role="alert" className={warnBox + " !mt-0"}>
          {t("li.consent.incomplete")}
        </p>
      ) : null}
      <p className={fieldHelp}>{state.on ? t("li.consent.help") : t("li.consent.none")}</p>
    </fieldset>
  );
}
