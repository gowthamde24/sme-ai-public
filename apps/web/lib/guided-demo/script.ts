import { moduleForPath } from "@/lib/packs/guard";

/**
 * The guided demo's story (owner request 28 Oct, job-guided-demo.md): six steps over the REAL screens of a DEMO workspace, each with a caption (`gd.<key>.t` and `gd.<key>.d`), the screen it highlights and what it does
 * with the person's own rights (lib/guided-demo/events.ts). The steps name screens, never a business type: a business type that does not have a screen's module (menu.ts says which) shows Today for that step instead.
 */
export const STEP_KEYS = ["lead", "reach", "ask", "followup", "visit", "today"] as const;
export type StepKey = (typeof STEP_KEYS)[number];
export const isStepKey = (v: unknown): v is StepKey => (STEP_KEYS as readonly unknown[]).includes(v);

/** The screen of each step, below the workspace's address ("" = Today). */
export const STEP_PAGES: Record<StepKey, string> = { lead: "/customers", reach: "/call-list", ask: "/chats", followup: "/followups", visit: "/visits", today: "" };

export type Line = { who: "assistant" | "lead"; text: string };
export type Sound = { base64: string; mime: string; seconds: number };
export type StepResult = { ok: true; lines: Line[]; sound: Sound | null; leadId: string | null; note: "none" | null } | { ok: false };

/** The address each step shows: its screen when the business type has the module, else Today. */
export function routesFor(base: string, modules: readonly string[] | null): Record<StepKey, string> {
  const out = {} as Record<StepKey, string>;
  for (const key of STEP_KEYS) {
    const path = `${base}${STEP_PAGES[key]}`;
    const need = STEP_PAGES[key] === "" || modules === null ? null : moduleForPath(path)?.module ?? null;
    out[key] = need !== null && !modules?.includes(need) ? base : path;
  }
  return out;
}

/** A line of a transcript or an answer, cut to what one caption box can hold. */
export const clip = (text: string, max = 500): string => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

/** The made-up lead of a run: a name and a phone number of the reserved demo range `+00 000 000 NNNN`. */
export function demoLead(run: string): { name: string; phone: string } {
  const digits = run.replace(/[^0-9]/g, "").padEnd(4, "7").slice(0, 4);
  return { name: `Demo lead ${digits}`, phone: `+00 000 000 ${digits}` };
}
