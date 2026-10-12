import { ApiContractError } from "./client";

/**
 * Small checks for reading an API answer (job CC). Every reader of the new screens ends in one of these: a value that is not what the contract says is an ApiContractError (the screen then says "could not load"),
 * never a guess and never rendered. Strings are bounded, so a hostile or broken answer cannot flood a page.
 */
export type Rec = Record<string, unknown>;
export const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

export function bad(what: string): never {
  throw new ApiContractError(`Unexpected ${what} in an API response.`);
}
export const rec = (v: unknown, what: string): Rec => (isRec(v) ? v : bad(what));
export const list = (v: unknown, what: string, max = 1000): unknown[] => (Array.isArray(v) && v.length <= max ? v : bad(what));
export const str = (v: unknown, what: string, max = 2000): string => (typeof v === "string" && v.length <= max ? v : bad(what));
export const optStr = (v: unknown, what: string, max = 2000): string | null => (v === null || v === undefined ? null : str(v, what, max));
export const bool = (v: unknown, what: string): boolean => (typeof v === "boolean" ? v : bad(what));
export const int = (v: unknown, what: string, min = 0, max = Number.MAX_SAFE_INTEGER): number => (typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max ? v : bad(what));
export const optInt = (v: unknown, what: string, min = 0, max = Number.MAX_SAFE_INTEGER): number | null => (v === null || v === undefined ? null : int(v, what, min, max));
export function iso(v: unknown, what: string): string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) && v.length <= 40 && !Number.isNaN(Date.parse(v)) ? v : bad(what);
}
export const optIso = (v: unknown, what: string): string | null => (v === null || v === undefined ? null : iso(v, what));
export const uuid = (v: unknown, what: string): string => (typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : bad(what));
export function oneOf<T extends string>(v: unknown, allowed: readonly T[], what: string): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : bad(what);
}
/** A closed word (letters, digits, underscore, dash): an API code or status that is shown through a table of our own words. */
export const word = (v: unknown, what: string, max = 60): string => (typeof v === "string" && v.length <= max && /^[A-Za-z0-9_.:-]+$/.test(v) ? v : bad(what));
/** A record of closed words to counts. */
export function counts(v: unknown, what: string): Record<string, number> {
  const r = rec(v, what);
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(r)) if (typeof n === "number" && Number.isSafeInteger(n)) out[word(k, what)] = n;
  return out;
}
