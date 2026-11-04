"use client";

import * as React from "react";

import type { LeadFinderCard, Search } from "@/lib/lead-finder/types";

import { PlanCard, ResultCard } from "../../prospects/SearchCards";
import { makeT, type Words } from "../../words";
import { decideSearch, type FinderOutcome } from "./conversation-api";

const PROBLEM: Record<Extract<FinderOutcome, { ok: false }>["error"], string> = { cap: "lf.err.cap", state: "lf.err.state", off: "lf.err.off", forbidden: "lf.plan.owner", down: "bv.chat.err.down" };

/**
 * The Lead Finder's card in the chat (docs/contracts/lead-finder.md section 1b), under the assistant's sentence ("... Shall I search?"): the same plan and result cards as the Prospects tab (prospects/SearchCards). OK (the Owner or an
 * Admin: `canApprove`) runs the search through this workspace's own route and the card becomes the result card in its place; Cancel throws the plan away. A salesperson sees the plan and who can OK it, with neither button. Nothing is
 * searched before the OK. A failed or cancelled search shows its closed card.
 */
export function ChatFinderCard({ card, words, base, onSearch }: { card: LeadFinderCard; words: Words; base: string; /** The search's new state after the card's own OK or Cancel (the chat is not told: the thread keeps it). */ onSearch: (search: Search) => void }) {
  const t = makeT(words);
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);
  const { search, canApprove } = card;
  const decide = async (decision: "approve" | "cancel") => {
    setBusy(true);
    setProblem(null);
    const out = await decideSearch(base, search.id, decision);
    setBusy(false);
    if (out.ok) onSearch(out.search);
    else setProblem(PROBLEM[out.error]);
  };
  return (
    <article data-chat="lead-finder" data-search={search.id} data-state={search.state} aria-label={t("lf.chat.card")} className="mt-2 flex flex-col gap-2">
      {search.state === "planned" ? (
        <PlanCard search={search} words={words} canApprove={canApprove} busy={busy} onOk={() => void decide("approve")} onCancel={canApprove ? () => void decide("cancel") : undefined} />
      ) : (
        <ResultCard search={search} words={words} base={base} demo />
      )}
      {problem ? (
        <p role="alert" className="text-sm font-medium text-red-text">
          {t(problem)}
        </p>
      ) : null}
    </article>
  );
}
