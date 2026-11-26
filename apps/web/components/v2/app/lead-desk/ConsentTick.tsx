"use client";

import { ShieldCheck } from "lucide-react";

import { Tick } from "../ds/Tick";
import { makeT, type Words } from "../words";

/**
 * The consent tick of a lead source (JOBS, owner 19 Nov, mock 08 part 1): ONE round tick with ONE sentence, and the help line under it. "Connect" stays off until it is ticked, so no source is ever connected on a form that does not tell people they will be
 * contacted. The API stores who ticked and when (`consent_confirmed: true`) and refuses a connect without it (422 `consent_required`, shown with the same sentence).
 */
export function ConsentTick({ words, checked, onChange, id }: { words?: Words; checked: boolean; onChange: (next: boolean) => void; id: string }) {
  const t = makeT(words);
  return (
    <div data-part="consent-tick" className="flex flex-col gap-2">
      <div className="rounded-xl border border-line bg-surface p-3 sm:p-3.5">
        <Tick id={id} checked={checked} onChange={(e) => onChange(e.target.checked)} aria-describedby={`${id}-help`} label={<span className="text-[16px] font-semibold leading-snug text-ink">{t("jobs.trust.consent")}</span>} />
      </div>
      <p id={`${id}-help`} className="m-0 flex items-start gap-2 text-sm text-muted">
        <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        {t("jobs.trust.consent.help")}
      </p>
    </div>
  );
}
