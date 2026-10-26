import type { ConsentVia, Consents, MarketingState } from "./types";

/**
 * The FAKE consent record of the test screens (job DQ part 2), only for DPDP_SCREENS=mock: the marketing choice and its short history live in one cookie of the browser, nothing is sent or stored on a server. SERVER ONLY.
 */
export const MOCK_COOKIE = "sme_dpdp_mock";
const VERSION = "2026-10-27";

type Stored = { s: MarketingState; at: string | null; h: { a: "given" | "withdrawn"; at: string; via: string }[] };
const EMPTY: Stored = { s: "not_given", at: null, h: [] };

export function parse(raw: string | undefined): Stored {
  try {
    const v = JSON.parse(raw ?? "") as Stored;
    if (!["not_given", "given", "withdrawn"].includes(v.s) || !Array.isArray(v.h)) return EMPTY;
    return { s: v.s, at: typeof v.at === "string" ? v.at : null, h: v.h.filter((r) => (r.a === "given" || r.a === "withdrawn") && typeof r.at === "string" && typeof r.via === "string").slice(0, 20) };
  } catch {
    return EMPTY;
  }
}
export const encode = (v: Stored): string => JSON.stringify(v);

export function toConsents(v: Stored): Consents {
  return { noticeVersion: VERSION, marketing: { state: v.s, since: v.at }, history: v.h.map((r) => ({ action: r.a, at: r.at, via: r.via, noticeVersion: VERSION })).reverse() };
}

/** The new state after a give or a withdraw; the same state again changes nothing (no new history row), as the API does. */
export function setMarketing(v: Stored, given: boolean, via: ConsentVia, now: Date): Stored {
  const next: MarketingState = given ? "given" : "withdrawn";
  if (v.s === next || (!given && v.s === "not_given")) return v;
  const at = now.toISOString();
  return { s: next, at, h: [...v.h, { a: next === "given" ? ("given" as const) : ("withdrawn" as const), at, via }].slice(-20) };
}
