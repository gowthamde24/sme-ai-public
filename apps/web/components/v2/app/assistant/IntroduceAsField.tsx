"use client";

import * as React from "react";

import { INTRODUCE_KINDS, INTRODUCE_LIMITS, introducePreview, introduceProblem, type IntroduceAs } from "@/lib/talk-training/introduce";

import { checkRow, fieldHelp, fieldInput, fieldLabel } from "../ui";
import type { Say } from "../words";

const h3 = "text-base font-semibold text-ink";

/**
 * "Introduce as" (C1, 11 Nov): how the assistant introduces itself on the Owner's own TEST call: the business (the default), the owner's name, or the owner's own words. The rules are shown in words, what is wrong is said as it is
 * typed (the same rules as the API's), a live preview shows the opening sentence, and a note says that Lead Desk calls to customers keep the business name for now. Only drawn where the API has the field.
 */
export function IntroduceAsField({ t, value, off, business, onChange, ownerName }: { t: Say; value: IntroduceAs; off: boolean; business: string | null; onChange: (v: IntroduceAs) => void; /** The Owner's first name from their profile when the panel knows it: null = there is none, so "My name" cannot be used (C1's contract); undefined = not known here, no limit */ ownerName?: string | null }) {
  const problem = introduceProblem(value);
  const typed = (value.text ?? "") !== "";
  const tpl = { business: t("tt.intro.pre.business"), owner: t("tt.intro.pre.owner"), custom: t("tt.intro.pre.custom") };
  const lim = value.kind === "owner" ? INTRODUCE_LIMITS.owner : INTRODUCE_LIMITS.custom;
  return (
    <fieldset data-part="tt-introduce" aria-describedby="tt-intro-help">
      <legend className={h3}>{t("tt.intro.title")}</legend>
      <p id="tt-intro-help" className={fieldHelp}>
        {t("tt.intro.help")}
      </p>
      {ownerName === null ? <p className={fieldHelp} data-part="tt-intro-noname">{t("tt.intro.noname")}</p> : null}
      <div className="mt-1 flex flex-col">
        {INTRODUCE_KINDS.map((k) => (
          <label key={k} className={checkRow}>
            <input type="radio" name="tt-introduce" value={k} checked={value.kind === k} disabled={off || (k === "owner" && ownerName === null)} onChange={() => onChange({ kind: k, text: k === "business" ? null : value.kind === "business" ? (k === "owner" && ownerName ? ownerName : "") : value.text })} className="size-5 shrink-0 accent-brand-text" />
            {t(`tt.intro.kind.${k}` as "tt.intro.kind.business")}
          </label>
        ))}
      </div>
      {value.kind === "business" ? null : (
        <div className="mt-2">
          <label htmlFor="tt-intro-text" className={fieldLabel}>
            {t(value.kind === "owner" ? "tt.intro.name" : "tt.intro.words")}
          </label>
          <input id="tt-intro-text" type="text" value={value.text ?? ""} disabled={off} maxLength={lim.max + 20} aria-invalid={typed && problem !== null} aria-describedby="tt-intro-msg" placeholder={t(value.kind === "owner" ? "tt.intro.name.eg" : "tt.intro.words.eg")} onChange={(e) => onChange({ ...value, text: e.target.value })} className={fieldInput} />
          <p id="tt-intro-msg" className={`${fieldHelp} ${typed && problem ? "font-semibold text-red-text" : ""}`} aria-live="polite" data-part="tt-intro-msg">
            {typed && problem ? t(`tt.intro.no.${problem}` as "tt.intro.no.short", { min: lim.min, max: lim.max }) : t(value.kind === "owner" ? "tt.intro.rule.owner" : "tt.intro.rule.custom", { min: lim.min, max: lim.max })}
          </p>
        </div>
      )}
      <p className="mt-2 rounded-lg bg-surface-2 p-3 text-base" data-part="tt-intro-preview" aria-live="polite">
        <span className="text-sm text-muted">{t("tt.intro.preview")} </span>
        {introducePreview(value, business, tpl)}
      </p>
      <p className={fieldHelp}>{t("tt.intro.note")}</p>
    </fieldset>
  );
}
