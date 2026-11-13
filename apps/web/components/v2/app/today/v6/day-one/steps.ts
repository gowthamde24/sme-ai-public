/**
 * The day-one checklist (design system v6, owner 13 Nov 2026): seven steps with their time estimates, the three middle ones optional (the assistant starts with working defaults), and what is needed to go live (a business name and a connected phone number; nothing else).
 * Pure: no fetch, no React. The server decides which steps are done from what it can read; a step it cannot read is not done.
 */
export const STEP_IDS = ["shop", "catalogue", "speaks", "rules", "practise", "phone", "sources"] as const;
export type StepId = (typeof STEP_IDS)[number];
/** Minutes each step takes (together "about 15 minutes"). */
export const STEP_MINUTES: Readonly<Record<StepId, number>> = { shop: 2, catalogue: 4, speaks: 2, rules: 2, practise: 2, phone: 1, sources: 2 };
/** Steps 3 to 5: "Optional · defaults are set". */
export const OPTIONAL_STEPS: ReadonlySet<StepId> = new Set<StepId>(["speaks", "rules", "practise"]);
export const TOTAL_MINUTES = STEP_IDS.reduce((sum, id) => sum + STEP_MINUTES[id], 0);

export type StepView = { id: StepId; minutes: number; optional: boolean; done: boolean; current: boolean; href: string };

/** Where each step opens (existing pages; the My assistant tabs are the assistant slice's). */
export function stepHref(id: StepId, base: string): string {
  switch (id) {
    case "shop":
      return `${base}/settings?section=business`;
    case "catalogue":
      return `${base}/catalogue`;
    case "speaks":
      return `${base}/my-assistant?tab=voice`;
    case "rules":
      return `${base}/my-assistant?tab=rules`;
    case "practise":
      return `${base}/my-assistant?tab=practice`;
    case "phone":
      return `${base}/phone-number`;
    case "sources":
      return `${base}/lead-sources`;
  }
}

/** The seven steps with the first one not done marked as the current one. */
export function stepViews(done: Readonly<Partial<Record<StepId, boolean>>>, base: string): StepView[] {
  const first = STEP_IDS.find((id) => !done[id]) ?? null;
  return STEP_IDS.map((id) => ({ id, minutes: STEP_MINUTES[id], optional: OPTIONAL_STEPS.has(id), done: done[id] === true, current: id === first, href: stepHref(id, base) }));
}
export const doneCount = (steps: readonly StepView[]): number => steps.filter((s) => s.done).length;

/** What the person chose about the checklist, kept per workspace in a cookie: `skipped` = "Skip for now" (Today shows the "Finish setup" chip), `dismissed` = the chip was put away. Anything else is "open". */
export type SetupChoice = "open" | "skipped" | "dismissed";

/**
 * Whether Today shows the checklist instead of the command band: until the assistant is live, unless it was skipped or the chip dismissed; `reopen` (the chip's link) shows it again whatever the state, once. Only for the people who set the business up (owner, admin).
 */
export function showChecklist({ live, choice, reopen, manages }: { live: boolean; choice: SetupChoice; reopen: boolean; manages: boolean }): boolean {
  if (!manages) return false;
  if (reopen) return true;
  return !live && choice === "open";
}
/** The small "Finish setup · N/7" chip: shown on the normal Today while steps are left and it was not dismissed (it disappears when all seven are done). */
export function showChip({ done, choice, checklistShown, manages }: { done: number; choice: SetupChoice; checklistShown: boolean; manages: boolean }): boolean {
  return manages && !checklistShown && choice !== "dismissed" && done < STEP_IDS.length;
}
