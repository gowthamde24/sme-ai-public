import { callerNamed } from "@/lib/calls/view";

/**
 * The live-call bar (app v4, owner 9 Nov 2026): what the browser needs of the calls that are live now. Built on the server from C1's `GET /calls?state=live` (and the lead's source), read in the browser by `parseLiveWire`.
 * Nothing is guessed: a source we have no word for is not shown; "Take over" is offered only to the Owner and Admin and only for a call that has been answered (the API's take-over socket needs one on the line); there is no
 * "Listen" (no sound of a live call reaches the app), so the person can "Read along" (the call page's live words). No phone number is ever part of this: the bar says the API's own `who`, a notification only a real name.
 */
export const SOURCE_KEYS = ["website", "indiamart", "email", "sheet", "meta", "typed"] as const;
export type SourceKey = (typeof SOURCE_KEYS)[number];
export type LiveCall = { id: string; who: string; named: boolean; elapsedS: number; answered: boolean; source: SourceKey | null; canTakeOver: boolean };
export type LiveWire = { calls: LiveCall[]; pollAfterS: number };

/** A lead's `source` (free text from the API: "indiamart", "IndiaMART", "website form"...) as one of the words we have, or null. */
export function sourceKeyOf(source: string | null | undefined): SourceKey | null {
  const s = (source ?? "").toLowerCase();
  if (/india\s*-?\s*mart/.test(s)) return "indiamart";
  if (/web\s*-?\s*site|web\s*form|\bsite\b/.test(s)) return "website";
  if (/e-?mail|inbox/.test(s)) return "email";
  if (/sheet|csv|import|upload/.test(s)) return "sheet";
  if (/meta|facebook|instagram|\bfb\b|\big\b/.test(s)) return "meta";
  if (/typed|manual|entered/.test(s)) return "typed";
  return null;
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The app's own route's answer, field by field (what cannot be read is dropped); null when it is not that answer at all. */
export function parseLiveWire(json: unknown): LiveWire | null {
  if (!isRec(json) || !Array.isArray(json.calls)) return null;
  const calls: LiveCall[] = [];
  for (const c of json.calls.slice(0, 10)) {
    if (!isRec(c) || typeof c.id !== "string" || !UUID.test(c.id)) continue;
    const who = typeof c.who === "string" ? c.who.trim().slice(0, 120) : "";
    const source = (SOURCE_KEYS as readonly unknown[]).includes(c.source) ? (c.source as SourceKey) : null;
    calls.push({
      id: c.id,
      who,
      named: callerNamed(who),
      elapsedS: typeof c.elapsed_s === "number" && Number.isFinite(c.elapsed_s) && c.elapsed_s >= 0 ? Math.min(Math.trunc(c.elapsed_s), 86_400) : 0,
      answered: c.answered === true,
      source,
      canTakeOver: c.can_take_over === true,
    });
  }
  const poll = typeof json.poll_after_s === "number" && Number.isFinite(json.poll_after_s) ? Math.min(Math.max(json.poll_after_s, 3), 30) : 5;
  return { calls, pollAfterS: poll };
}

/** The wire shape (snake_case) the route sends. */
export function liveWire(w: LiveWire): { calls: { id: string; who: string; elapsed_s: number; answered: boolean; source: SourceKey | null; can_take_over: boolean }[]; poll_after_s: number } {
  return { calls: w.calls.map((c) => ({ id: c.id, who: c.who, elapsed_s: c.elapsedS, answered: c.answered, source: c.source, can_take_over: c.canTakeOver })), poll_after_s: w.pollAfterS };
}
