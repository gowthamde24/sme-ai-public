/**
 * The Lead Finder's weekly sweep (C1's PROPOSAL docs/contracts/lead-finder-sweep.md, 11 Nov 2026; nothing of it exists in the API yet): a saved search the scheduler runs by itself once a week. It never dials anyone. Pure and client-safe:
 * the shapes the screens read (checked field by field, a field that does not fit is dropped and an answer that is not a sweep is null), the form's rules, and the words' keys. No request, no dictionary.
 */
import { searchTextProblem } from "./types";

export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const; // 1 = Monday ... 7 = Sunday (the contract)
export const HOURS = Array.from({ length: 24 }, (_, h) => h);
export const RESULT_CHOICES = [5, 10, 20] as const; // the plan card's own cap is 20 (docs/contracts/lead-finder.md)
export const DEFAULT_WEEKDAY = 1;
export const DEFAULT_HOUR = 7; // Monday 07:00 (the contract's default for the form)
export const DEFAULT_RESULTS = 20;

export const SKIP_REASONS = ["switched_off", "search_cap", "budget", "not_in_plan", "provider_down"] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];
export const RUN_STATES = ["done", "failed", "skipped"] as const;
export type RunState = (typeof RUN_STATES)[number];

export type RunCounts = { found: number; new: number; duplicates: number; callReady: number; needsOwner: number; skipped: number };
export type SweepRun = { id: string; sweepId: string; state: RunState; skipReason: SkipReason | null; searchId: string | null; startedAt: string; finishedAt: string | null; costPaise: number; counts: RunCounts | null; newSinceLastRun: number; trigger: "schedule" | "owner" };
export type Sweep = {
  id: string;
  query: string;
  area: string;
  maxResults: number;
  weekday: number;
  hour: number;
  enabled: boolean;
  provider: "fixture" | "places";
  estCostPaise: number;
  costIsEstimate: boolean;
  attribution: string | null;
  nextRunAt: string | null;
  lastRun: SweepRun | null;
  createdAt: string;
};
export type SweepList = { items: Sweep[]; maxSweeps: number; weeklyBudgetPaise: number };
/** What the form sends: the owner's words ("find new retailers in Jayanagar"), the language they were written in, and when. */
export type SweepInput = { text: string; language: string; weekday: number; hour: number; maxResults: number };
export type SweepChange = { weekday?: number; hour?: number; maxResults?: number; enabled?: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T[\d:.+\-Z]{4,40}$/;
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const int = (v: unknown, min: number, max: number): number | null => (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null);
const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim().length > 0 && v.length <= max ? v.trim() : null);
const iso = (v: unknown): string | null => (typeof v === "string" && ISO.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);
const uuid = (v: unknown): string | null => (typeof v === "string" && UUID.test(v) ? v : null);

export function parseRun(raw: unknown): SweepRun | null {
  if (!isRec(raw)) return null;
  const id = uuid(raw.id);
  const sweepId = uuid(raw.sweep_id);
  const state = (RUN_STATES as readonly unknown[]).includes(raw.state) ? (raw.state as RunState) : null;
  const startedAt = iso(raw.started_at);
  if (!id || !sweepId || !state || !startedAt) return null;
  const c = isRec(raw.counts) ? raw.counts : null;
  const n = (k: string) => int(c?.[k] ?? 0, 0, 100_000) ?? 0; // absent = 0 (the contract)
  return {
    id,
    sweepId,
    state,
    skipReason: (SKIP_REASONS as readonly unknown[]).includes(raw.skip_reason) ? (raw.skip_reason as SkipReason) : null,
    searchId: uuid(raw.search_id),
    startedAt,
    finishedAt: iso(raw.finished_at),
    costPaise: int(raw.cost_paise ?? 0, 0, 100_000_000) ?? 0,
    counts: c ? { found: n("found"), new: n("new"), duplicates: n("duplicates"), callReady: n("call_ready"), needsOwner: n("needs_owner"), skipped: n("skipped") } : null,
    newSinceLastRun: int(raw.new_since_last_run ?? 0, 0, 100_000) ?? 0,
    trigger: raw.trigger === "owner" ? "owner" : "schedule",
  };
}

export function parseSweep(raw: unknown): Sweep | null {
  if (!isRec(raw)) return null;
  const id = uuid(raw.id);
  const query = text(raw.query, 200);
  const area = text(raw.area, 200);
  const weekday = int(raw.weekday, 1, 7);
  const hour = int(raw.hour, 0, 23);
  const maxResults = int(raw.max_results, 1, 20);
  const createdAt = iso(raw.created_at);
  if (!id || !query || !area || weekday === null || hour === null || maxResults === null || !createdAt || typeof raw.enabled !== "boolean") return null;
  return {
    id,
    query,
    area,
    maxResults,
    weekday,
    hour,
    enabled: raw.enabled,
    provider: raw.provider === "places" ? "places" : "fixture",
    estCostPaise: int(raw.est_cost_paise ?? 0, 0, 100_000_000) ?? 0,
    costIsEstimate: raw.cost_is_estimate === true,
    attribution: text(raw.attribution, 60),
    nextRunAt: raw.enabled ? iso(raw.next_run_at) : null, // paused: no next run, whatever was sent
    lastRun: parseRun(raw.last_run),
    createdAt,
  };
}

export function parseSweepList(raw: unknown): SweepList | null {
  if (!isRec(raw) || !Array.isArray(raw.items)) return null;
  const items = raw.items.slice(0, 20).flatMap((x) => {
    const s = parseSweep(x);
    return s ? [s] : [];
  });
  return { items, maxSweeps: int(raw.max_sweeps, 1, 50) ?? 5, weeklyBudgetPaise: int(raw.weekly_budget_paise ?? 0, 0, 100_000_000) ?? 0 };
}

export function parseRuns(raw: unknown): SweepRun[] | null {
  if (!isRec(raw) || !Array.isArray(raw.items)) return null;
  return raw.items.slice(0, 50).flatMap((x) => {
    const r = parseRun(x);
    return r ? [r] : [];
  });
}

export type SweepProblem = "empty" | "too_long" | "weekday" | "hour" | "results";
/** The form's rules, the API's own (it refuses the same with a 422): the words 2 to 300 characters, the day 1 to 7, the hour 0 to 23, the cap 1 to 20. */
export function sweepProblem(input: SweepInput): SweepProblem | null {
  const t = searchTextProblem(input.text);
  if (t) return t;
  if (int(input.weekday, 1, 7) === null) return "weekday";
  if (int(input.hour, 0, 23) === null) return "hour";
  if (int(input.maxResults, 1, 20) === null) return "results";
  return null;
}

/** The dictionary key of a skipped run's reason; a word we do not know is the calm general one. */
export const skipKey = (reason: string | null): string => `sw.skip.${reason !== null && (SKIP_REASONS as readonly string[]).includes(reason) ? reason : "other"}`;

/** "07:00": the hour as the calling hours are written everywhere in the app (24-hour, India time). */
export const hourWord = (hour: number): string => `${String(hour).padStart(2, "0")}:00`;

/** The next time a weekly sweep runs, in ms since 1970 (from `now`), for the mock: the same weekday and hour in India time (UTC+5:30). */
export function nextRunMs(weekday: number, hour: number, now: number): number {
  const IST = 5.5 * 3_600_000;
  const local = new Date(now + IST);
  const today = local.getUTCDay() === 0 ? 7 : local.getUTCDay(); // 1 = Monday ... 7 = Sunday
  let days = (weekday - today + 7) % 7;
  const at = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + days, hour, 0, 0) - IST;
  if (at <= now) days += 7;
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + days, hour, 0, 0) - IST;
}
