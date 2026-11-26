"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import type { Done } from "@/lib/lists/types";

import { btnMain } from "../ui";
import { makeT, type Words } from "../words";

/**
 * "Add starter lists" on the empty What you sell page of a TEXTILE shop (owner, 26 Nov 2026: a textile owner sells more than sarees). One plain sentence says what the button makes; nothing is made until it is pressed. The lists can be renamed, changed or deleted afterwards (List settings), and the owner can add his own.
 * The route is idempotent (C1): pressing twice never makes a second set.
 */
export function StarterLists({ words, make }: { words: Words; make: () => Promise<Done<true>> }) {
  const t = makeT(words);
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setProblem(null);
    const r = await make();
    if (r.ok) return router.refresh();
    setBusy(false);
    setProblem(t(`wls.err.${r.error}` as "wls.err.unavailable"));
  };
  return (
    <section data-part="starter-lists" aria-labelledby="wls-starter-h" className="rounded-[14px] border border-line bg-surface p-[18px]">
      <h2 id="wls-starter-h" className="m-0 font-display text-xl font-semibold">
        {t("wls.starter.title")}
      </h2>
      <p className="m-0 mt-1 text-[15px] text-muted">{t("wls.starter.sub")}</p>
      {problem ? (
        <p role="alert" className="m-0 mt-3 text-[15px] font-semibold text-ink">
          {problem}
        </p>
      ) : null}
      <button type="button" data-action="make-starters" disabled={busy} onClick={() => void go()} className={`${btnMain} mt-4`}>
        {busy ? t("wls.saving") : t("wls.starter.go")}
      </button>
      <p className="m-0 mt-2 text-[14px] text-muted">{t("wls.starter.note")}</p>
    </section>
  );
}
