import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { addLine as apiAdd, changeLine, readOverview } from "@/lib/api/extra-lines";
import { readJar, writeJar } from "@/lib/mock/jar";
import { extraLines } from "@/lib/screens/flag";

import { DEFAULT_CAP, MOCK_CREDITS, MOCK_PRICE, REFUSAL_REASONS, isKey, isLineId, mockOverview, type ExtraLines, type LineResult, type RefusalReason, type Refusal } from "./types";

/**
 * Where the extra lines come from. `off` (EXTRA_LINES unset) = nothing here: "Add a line" stays the mail to us; `mock` (staging) = made-up lines kept in ONE small cookie, nothing is charged; `on` = C1's routes
 * (lib/api/extra-lines.ts). `unread` = the route could not be read (an older server answers 404): the card says nothing about lines it cannot see, it never guesses. Every input is checked again here (the
 * browser is not trusted); only the Owner adds or cancels (the action checks the role, the server checks it again and asks for the second factor when the Owner turned it on).
 */
export const COOKIE = "sme_extra_lines_mock";
type Kept = { n: number; cancelled: number; credits: number };
const parseKept = (v: unknown): Kept | null => {
  const x = v as Partial<Kept> | null;
  const ok = (m: unknown): m is number => typeof m === "number" && Number.isSafeInteger(m) && m >= 0 && m <= 1000;
  return x && ok(x.n) && ok(x.cancelled) && ok(x.credits) && x.cancelled <= x.n ? { n: x.n, cancelled: x.cancelled, credits: x.credits } : null;
};
const FRESH: Kept = { n: 0, cancelled: 0, credits: MOCK_CREDITS };

export type Read = { mode: "off" } | { mode: "unread" } | { mode: "ok"; data: ExtraLines; mock: boolean };

export async function readExtraLines(token: string, tenantId: string): Promise<Read> {
  const mode = extraLines();
  if (mode === "off") return { mode: "off" };
  if (mode === "mock") {
    const kept = await readJar(COOKIE, parseKept, FRESH);
    return { mode: "ok", data: mockOverview(kept.n, kept.cancelled), mock: true };
  }
  try {
    const data = await readOverview(token, tenantId);
    return data.enabled ? { mode: "ok", data, mock: false } : { mode: "off" };   // the platform switch is off for now: the card is as it was
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return { mode: "unread" };
  }
}

export async function addExtraLine(token: string, tenantId: string, key: unknown): Promise<LineResult> {
  const mode = extraLines();
  if (mode === "off" || !isKey(key)) return { ok: false, error: "invalid" };
  if (mode === "mock") {
    const kept = await readJar(COOKIE, parseKept, FRESH);
    if (2 + kept.n >= DEFAULT_CAP) return { ok: false, error: "unavailable", reason: "at_limit" };
    if (kept.credits < MOCK_PRICE) return { ok: false, error: "unavailable", reason: "not_enough_credits" };
    return (await writeJar(COOKIE, { ...kept, n: kept.n + 1, credits: kept.credits - MOCK_PRICE })) ? { ok: true } : { ok: false, error: "down" };
  }
  try {
    await apiAdd(token, tenantId, key);
    return { ok: true };
  } catch (error) {
    return refused(error);
  }
}

/** Cancel (`move` "cancel": the line works to the end of the paid month) or take the cancel back ("keep"). */
export async function moveExtraLine(token: string, tenantId: string, lineId: unknown, move: "cancel" | "keep"): Promise<LineResult> {
  const mode = extraLines();
  if (mode === "off" || !isLineId(lineId)) return { ok: false, error: "invalid" };
  if (mode === "mock") {
    const kept = await readJar(COOKIE, parseKept, FRESH);
    const index = Number(lineId.slice(-12)) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= kept.n) return { ok: false, error: "unavailable", reason: "not_found" };
    // the mock keeps a count of cancelled lines (the first ones): enough to draw both buttons
    const cancelled = move === "cancel" ? Math.min(kept.n, Math.max(kept.cancelled, index + 1)) : Math.min(kept.cancelled, index);
    return (await writeJar(COOKIE, { ...kept, cancelled })) ? { ok: true } : { ok: false, error: "down" };
  }
  try {
    await changeLine(token, tenantId, lineId, move);
    return { ok: true };
  } catch (error) {
    return refused(error);
  }
}

const reasonOf = (error: ApiRequestError): RefusalReason | undefined => {
  const w = error.reason ?? error.extra?.fields?.[0];
  return (REFUSAL_REASONS as readonly string[]).includes(w ?? "") ? (w as RefusalReason) : undefined;
};

function refused(error: unknown): Refusal {
  if (error instanceof ApiAuthError) throw error;
  if (error instanceof ApiRequestError) {
    if (error.status === 403) return { ok: false, error: error.code === "step_up_required" ? "step_up" : "forbidden" };
    if (error.status === 422) return { ok: false, error: "invalid" };
    if (error.status === 404) return { ok: false, error: "unavailable", reason: "not_found" };
    if (error.status === 409) return { ok: false, error: "unavailable", reason: reasonOf(error) };
  }
  return { ok: false, error: "down" };
}
