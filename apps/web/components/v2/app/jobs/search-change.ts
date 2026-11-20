import type { Dispatch, SetStateAction } from "react";

import type { JobPlan, SearchPatch } from "@/lib/jobs/plan";

import type { PlanCardState } from "./PlanCard";

/**
 * A Lead Finder plan's choice: only what changed goes to `PATCH /jobs/plan/{id}`; the whole plan comes back (the same id). Loaded on the first change (a dynamic import), so the New job page's own script, which is at its route-JS ceiling, carries none of it.
 */
export async function changeSearch(
  patch: SearchPatch,
  plan: JobPlan | null,
  search: ((planId: string, patch: SearchPatch) => Promise<{ ok: true; data: JobPlan } | { ok: false; error: string }>) | undefined,
  setPlan: Dispatch<SetStateAction<JobPlan | null>>,
  setCard: Dispatch<SetStateAction<PlanCardState>>,
): Promise<void> {
  if (!plan || !search) return;
  setCard((c) => ({ ...c, searching: true, error: null }));
  const r = await search(plan.planId, patch);
  if (!r.ok) {
    setCard((c) => ({ ...c, searching: false, error: r.error }));
    return;
  }
  setPlan(r.data);
  setCard((c) => ({ ...c, searching: false }));
}
