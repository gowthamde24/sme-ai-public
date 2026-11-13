import { readJar, writeJar } from "@/lib/mock/jar";

import type { SetupChoice } from "@/components/v2/app/today/v6/day-one/steps";

/**
 * What the person chose about the day-one checklist, per workspace (design system v6): "Skip for now" (`skipped`: Today shows the "Finish setup" chip) or the chip put away (`dismissed`). A small cookie of this browser, checked on every read; nothing is sent anywhere.
 * A workspace not in it is `open`. SERVER ONLY.
 */
export const CHOICE_COOKIE = "sme_setup_choice";
const MAX_KEPT = 8;
const DAYS = 90;
const isChoice = (v: unknown): v is SetupChoice => v === "open" || v === "skipped" || v === "dismissed";

const parse = (v: unknown): Record<string, SetupChoice> | null => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const out: Record<string, SetupChoice> = {};
  for (const [k, c] of Object.entries(v)) if (/^[0-9a-f-]{36}$/i.test(k) && isChoice(c)) out[k] = c;
  return out;
};

export async function readChoice(tenantId: string): Promise<SetupChoice> {
  return (await readJar(CHOICE_COOKIE, parse, {}))[tenantId] ?? "open";
}

export async function writeChoice(tenantId: string, choice: SetupChoice): Promise<boolean> {
  const kept = await readJar(CHOICE_COOKIE, parse, {});
  const next = Object.fromEntries([...Object.entries(kept).filter(([k]) => k !== tenantId), [tenantId, choice]].slice(-MAX_KEPT));
  return writeJar(CHOICE_COOKIE, next, DAYS);
}
