"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { btnMain } from "../ui";

import type { PackState } from "@/app/app/tenants/[tenantId]/start/actions";
import { labelOk, OTHER_ID, OTHER_LABEL } from "@/lib/packs/other-label";

import { makeT, type Words } from "../words";
import { TypeSearch } from "./TypeSearch";

export type TypeChoice = { id: string; name: string; line: string; /** synonyms and the name in other languages, for the search */ keywords?: string };

/**
 * "What kind of business?" (owner, 25 Nov 2026): asked ONCE, for a workspace made without a type, so that the first steps, the words and the fields are the business's own and not a saree shop's. The
 * types come from the API's list (`GET /packs`), one boxed TILE each (name, one grey line; 3 per row; the chosen one has an ink border, never a tint: BOXED vs OPEN, tiles that are compared) under a search box (TypeSearch: matches first, Enter takes the only match); the choice is saved with `PUT /pack` and the page then
 * shows that type's Get started steps.
 */
export function TypePicker({ choices, words, save }: { choices: readonly TypeChoice[]; words: Words; save: (code: string, label?: string) => Promise<PackState> }) {
  const t = makeT(words);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [label, setLabel] = useState("");
  const needsLabel = picked === OTHER_ID;
  // a pick is only a pick: nothing is saved until "Continue" (owner, 25 Nov 2026: a black border alone told him nothing)
  const pick = (id: string) => {
    setPicked(id);
    setError(null);
  };
  // once saved, the page is asked again for the first steps; if this picker is still there a moment later (a cached read), it is asked again, a few times
  useEffect(() => {
    if (!saved) return;
    const timers = [1500, 4000, 8000].map((ms) => setTimeout(() => router.refresh(), ms));
    return () => timers.forEach(clearTimeout);
  }, [saved, router]);
  const go = () => {
    if (!picked || (needsLabel && !labelOk(label))) return;
    setError(null);
    start(async () => {
      const r = await save(picked, needsLabel ? label : undefined);
      if (r.ok) {
        setSaved(true);
        router.refresh();
      } else {
        setError(t(r.error === "step_up" ? "start.type.err.step_up" : r.error === "role" ? "start.type.err.role" : r.error === "label" ? "start.type.other.err" : "start.type.err"));
      }
    });
  };
  const name = choices.find((c) => c.id === picked)?.name ?? "";
  return (
    <fieldset data-part="start-type" className="m-0 min-w-0 border-0 p-0">
      <legend className="mb-1 text-[20px] font-semibold text-ink">{t("start.type.title")}</legend>
      <p className="m-0 mb-3 text-[15px] text-muted">{t("start.type.sub")}</p>
      <TypeSearch choices={choices} words={words} value={picked} onPick={pick} disabled={pending || saved} />
      {needsLabel ? (
        <div className="mt-4 flex max-w-md flex-col gap-1" data-part="type-other">
          <label htmlFor="type-other-label" className="text-[15px] font-bold text-ink">
            {t("start.type.other.label")}
          </label>
          <input id="type-other-label" value={label} minLength={OTHER_LABEL.min} maxLength={OTHER_LABEL.max} required autoComplete="off" placeholder={t("start.type.other.example")} disabled={pending || saved} onChange={(e) => setLabel(e.target.value)} className="min-h-12 w-full rounded-lg border border-edge bg-surface px-3 text-base text-ink focus:border-brand-edge" />
          <small className="text-[14px] text-muted">{t("start.type.other.hint")}</small>
        </div>
      ) : null}
      <div className="mt-4 flex flex-col gap-2" data-part="type-next">
        <p className="m-0 text-[15px] text-muted" role="status" data-part="type-status">
          {saved ? t("start.type.saved", { name }) : pending ? t("start.type.saving") : picked ? t("start.type.chosen", { name }) : t("start.type.pickfirst")}
        </p>
        <div>
          <button type="button" data-part="type-continue" disabled={!picked || (needsLabel && !labelOk(label)) || pending || saved} onClick={go} className={btnMain}>
            {pending || saved ? t("start.type.saving.btn") : picked ? t("start.type.continue.with", { name }) : t("start.type.continue")}
          </button>
        </div>
      </div>
      {error ? (
        <p role="alert" className="m-0 mt-3 text-[15px] font-medium text-red-text">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
