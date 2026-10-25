import { EARLY, WORKERS } from "@/components/v2/app/mark/workers";
import type { SiteT } from "@/i18n/site";

export type WorkerStep = { n: number; name: string; text: string; you: string; early: boolean };

/** The six steps (the six AI workers, in the order of the workflow: find leads, research, AI calls, WhatsApp, outcome, follow-up) in the shared words (hm.w.N.*): the home page's band and /how-it-works read the same list, so they cannot drift apart. */
export function workerSteps(t: SiteT): WorkerStep[] {
  return WORKERS.map((n) => ({ n, name: t(`hm.w.${n}.n`), text: t(`hm.w.${n}.d`), you: t(`hm.w.${n}.y`), early: EARLY.includes(n) }));
}
