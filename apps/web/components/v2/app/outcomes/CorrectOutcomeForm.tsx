"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import type { Outcome, OutcomeCategory, OutcomeResult } from "@/lib/outcomes/types";

import { btnMain, btnQuiet, fieldInput, fieldLabel } from "../ui";
import { makeT, type Words } from "../words";
import type { CorrectOutcome } from "./types";

/** "Correct this" under one outcome (job DM): the owner changes the result and what kind of result it was (the categories that go with the result); saving asks the server, then the screen is read again. */
export function CorrectOutcomeForm({ words, outcome, options, correct }: { words: Words; outcome: Outcome; options: Record<OutcomeResult, readonly OutcomeCategory[]>; correct: CorrectOutcome }) {
  const t = makeT(words);
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [result, setResult] = React.useState<OutcomeResult>(outcome.result);
  const [category, setCategory] = React.useState<OutcomeCategory>(outcome.category);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(false);
  const pick = (r: OutcomeResult) => {
    setResult(r);
    if (!options[r].includes(category)) setCategory(options[r][0]);
  };
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className={`${btnQuiet} mt-2 !min-h-11 !px-3 text-sm`}>
        {t("outcome.fix")}
      </button>
    );
  return (
    <form
      className="mt-3 flex flex-col gap-3 rounded-lg border border-line bg-surface-2 p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(false);
        let ok = false;
        try {
          ok = (await correct(outcome.id, result, category)).ok;
        } catch {
          ok = false;
        }
        setBusy(false);
        if (ok) {
          setOpen(false);
          router.refresh();
        } else setError(true);
      }}
    >
      <div>
        <label htmlFor={`fix-result-${outcome.id}`} className={fieldLabel}>
          {t("outcome.fix.result")}
        </label>
        <select id={`fix-result-${outcome.id}`} value={result} onChange={(e) => pick(e.target.value as OutcomeResult)} className={fieldInput}>
          {(Object.keys(options) as OutcomeResult[]).map((r) => (
            <option key={r} value={r}>
              {t(`outcome.result.${r}`)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={`fix-cat-${outcome.id}`} className={fieldLabel}>
          {t("outcome.fix.cat")}
        </label>
        <select id={`fix-cat-${outcome.id}`} value={category} onChange={(e) => setCategory(e.target.value as OutcomeCategory)} className={fieldInput}>
          {options[result].map((c) => (
            <option key={c} value={c}>
              {t(`outcome.cat.${c}`)}
            </option>
          ))}
        </select>
      </div>
      {error ? (
        <p role="alert" className="text-sm font-medium text-red-text">
          {t("outcome.fix.err")}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={busy} className={btnMain}>
          {t("outcome.fix.save")}
        </button>
        <button type="button" disabled={busy} onClick={() => setOpen(false)} className={btnQuiet}>
          {t("outcome.fix.cancel")}
        </button>
      </div>
    </form>
  );
}
