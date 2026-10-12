import type { SetupFacts } from "./types";

/** The steps of the wizard, in order. A step for inviting the family is not here: the API has no invitation route yet (see the job BJ report). */
export const STEPS = ["shop", "hours", "saree", "agent", "ready"] as const;
export type StepId = (typeof STEPS)[number];
/** The steps that carry a number ("Step 2 of 4"): every one but the last. */
export const NUMBERED = 4;

/** What this browser remembers about the setup of one workspace (a convenience of this device: the API keeps no setup state). */
export type Local = {
  /** `new`: not started or in progress; `skipped`: "Set up later"; `done`: the last screen was reached; `dismissed`: the checklist was hidden. */
  state: "new" | "skipped" | "done" | "dismissed";
  step: number;
  /** The Agent OWL step has been seen. */
  agentSeen: boolean;
  /** Done in this session, before the page has read the API again. */
  hoursDone: boolean;
  sareeDone: boolean;
};
export const NEW_LOCAL: Local = { state: "new", step: 0, agentSeen: false, hoursDone: false, sareeDone: false };

export type ItemId = "hours" | "saree" | "agent";
export type Item = { id: ItemId; done: boolean; step: number };

/** The things still to do, from the API's facts and what this device saw. An unknown fact is not "done". */
export function itemsOf(facts: SetupFacts, local: Local): Item[] {
  return [
    { id: "hours", done: facts.hours?.saved === true || local.hoursDone, step: STEPS.indexOf("hours") },
    { id: "saree", done: (facts.sarees ?? 0) > 0 || local.sareeDone, step: STEPS.indexOf("saree") },
    { id: "agent", done: local.agentSeen, step: STEPS.indexOf("agent") },
  ];
}

/** A brand-new workspace: the hours were never saved and the catalogue is empty, both read successfully. Anything unknown is "not new" (never block Today on a failed read). */
export const isFresh = (facts: SetupFacts): boolean => facts.hours !== null && !facts.hours.saved && facts.sarees === 0;

export type View = "wizard" | "checklist" | "plain";

/** What the Owner sees on Today: the wizard instead of an empty Today (a new workspace, not skipped), the checklist card above Today (something is left), or Today as it is. */
export function viewOf(facts: SetupFacts, local: Local): View {
  // in progress: the person has left the first step and not skipped or finished. The wizard stays until they do, even though what they save makes the facts say "not new" (and the Agent OWL step marks itself seen).
  if (local.state === "new" && local.step > 0) return "wizard";
  const items = itemsOf(facts, local);
  if (items.every((i) => i.done)) return "plain";
  if (local.state === "dismissed") return "plain";
  if (local.state === "done" || local.state === "skipped") return "checklist";
  return isFresh(facts) ? "wizard" : "checklist";
}

/** The first step with something left (for "Continue setup"); the Agent OWL step if only that is left; 0 if all is done. */
export const firstOpenStep = (items: readonly Item[]): number => items.find((i) => !i.done)?.step ?? 0;

/** The saree-shop opening hours the hours step starts from when the business has not saved its own: Monday to Saturday, 10:00 to 20:30, visits of 30 minutes, two at once. */
export const SHOP_DEFAULTS = { open: "10:00", close: "20:30", days: ["mon", "tue", "wed", "thu", "fri", "sat"] as const, slot: 30, parallel: 2 };
