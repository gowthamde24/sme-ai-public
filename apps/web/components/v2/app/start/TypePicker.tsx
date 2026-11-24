"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { PackState } from "@/app/app/tenants/[tenantId]/start/actions";
import { makeT, type Words } from "../words";
import { TYPE_TILE } from "./tile";

export type TypeChoice = { id: string; name: string; line: string };

/**
 * "What kind of business?" (owner, 25 Nov 2026): asked ONCE, for a workspace made without a type, so that the first steps, the words and the fields are the business's own and not a saree shop's. The
 * types come from the API's list (`GET /packs`), one boxed TILE each (name, one grey line; 3 per row; the chosen one has an ink border, never a tint: BOXED vs OPEN, tiles that are compared); the choice is saved with `PUT /pack` and the page then
 * shows that type's Get started steps.
 */
export function TypePicker({ choices, words, save }: { choices: readonly TypeChoice[]; words: Words; save: (code: string) => Promise<PackState> }) {
  const t = makeT(words);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const choose = (id: string) => {
    setPicked(id);
    setError(null);
    start(async () => {
      const r = await save(id);
      if (r.ok) router.refresh();
      else {
        setPicked(null);
        setError(t(r.error === "step_up" ? "start.type.err.step_up" : r.error === "role" ? "start.type.err.role" : "start.type.err"));
      }
    });
  };
  return (
    <fieldset data-part="start-type" className="m-0 min-w-0 border-0 p-0">
      <legend className="mb-1 text-[20px] font-semibold text-ink">{t("start.type.title")}</legend>
      <p className="m-0 mb-3 text-[15px] text-muted">{t("start.type.sub")}</p>
      <div role="radiogroup" aria-label={t("start.type.title")} className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3">
        {choices.map((c) => (
          <label
            key={c.id}
            data-type={c.id}
            data-picked={picked === c.id ? "" : undefined}
            className={TYPE_TILE}
          >
            <input type="radio" name="start-type" value={c.id} checked={picked === c.id} disabled={pending} onChange={() => choose(c.id)} className="sr-only" />
            <span className="block text-[16px] font-semibold text-ink">{c.name}</span>
            {c.line ? <span className="block text-sm text-muted">{c.line}</span> : null}
          </label>
        ))}
      </div>
      {error ? (
        <p role="alert" className="m-0 mt-3 text-[15px] font-medium text-red-text">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
