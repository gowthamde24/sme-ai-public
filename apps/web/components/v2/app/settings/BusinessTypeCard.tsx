"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { PackState } from "@/app/app/tenants/[tenantId]/start/actions";
import type { TypeRow } from "@/lib/packs/type-search";

import { TypeSearch } from "../start/TypeSearch";
import { btnMain, btnQuiet } from "../ui";
import { makeT, type Words } from "../words";

/**
 * Settings > "Business type" (Owner only; owner, 26 Nov 2026): shows the current type and lets the Owner pick another with the same search box as the first-run page. Choosing only highlights; a plain sentence asks first ("Change to Clinic?
 * Your existing things stay; the questions and fields for the new type are added."); only "Change" saves (the existing `PUT /pack`). Saved is shown once the API has answered.
 */
export function BusinessTypeCard({ words, current, choices, save }: { words: Words; current: { id: string; name: string }; choices: readonly TypeRow[]; save: (code: string) => Promise<PackState> }) {
  const t = makeT(words);
  const router = useRouter();
  const [mode, setMode] = useState<"view" | "pick">("view");
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const shown = choices.find((c) => c.id === picked);
  const change = () => {
    if (!picked) return;
    setError(null);
    start(async () => {
      const r = await save(picked);
      if (r.ok) {
        setDone(shown?.name ?? "");
        setMode("view");
        setPicked(null);
        router.refresh();
      } else setError(t(r.error === "step_up" ? "start.type.err.step_up" : r.error === "role" ? "start.type.err.role" : "start.type.err"));
    });
  };
  return (
    <div data-part="business-type" className="flex flex-col gap-3">
      <p className="m-0 mt-2 text-base">
        <span className="text-muted">{t("bt.current")} </span>
        <b data-part="bt-current">{done ?? current.name}</b>
      </p>
      {done ? <p role="status" className="m-0 text-[15px] text-muted">{t("bt.saved", { name: done })}</p> : null}
      {mode === "view" ? (
        <div>
          <button type="button" data-part="bt-change" onClick={() => (setMode("pick"), setDone(null))} className={btnQuiet}>
            {t("bt.change")}
          </button>
        </div>
      ) : (
        <>
          <TypeSearch choices={choices.filter((c) => c.id !== current.id)} words={words} name="bt-type" value={picked} onPick={setPicked} disabled={pending} />
          {picked && shown ? (
            <div role="group" aria-label={t("bt.change")} data-part="bt-confirm" className="flex flex-col gap-2 border-y border-line py-3">
              <p className="m-0 text-[15px] text-ink">{t("bt.confirm", { name: shown.name })}</p>
              <div className="flex flex-wrap gap-3">
                <button type="button" data-part="bt-yes" disabled={pending} onClick={change} className={btnMain}>
                  {pending ? t("start.type.saving.btn") : t("bt.yes", { name: shown.name })}
                </button>
                <button type="button" disabled={pending} onClick={() => setPicked(null)} className={btnQuiet}>
                  {t("bt.no")}
                </button>
              </div>
            </div>
          ) : null}
          <div>
            <button type="button" disabled={pending} onClick={() => (setMode("view"), setPicked(null), setError(null))} className="min-h-11 text-[15px] text-muted underline underline-offset-4">
              {t("bt.cancel")}
            </button>
          </div>
        </>
      )}
      {error ? <p role="alert" className="m-0 text-[15px] font-medium text-red-text">{error}</p> : null}
    </div>
  );
}
