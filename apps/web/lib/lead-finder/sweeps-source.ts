import { randomUUID } from "node:crypto";

import { cookies } from "next/headers";

import { ApiRequestError } from "@/lib/api/client";
import { changeSweep, createSweep, listSweepRuns, listSweeps, previewSweep, removeSweep, runSweepNow } from "@/lib/api/lead-finder-sweeps";
import { sweepScreens } from "@/lib/screens/flag";

import { nextRunMs, parseSweep, parseSweepList, parseSweepPreview, sweepProblem, type RunState, type Sweep, type SweepChange, type SweepInput, type SweepList, type SweepPreview, type SweepRun } from "./sweeps";

/**
 * Where the weekly searches come from and go (job sweep-screens; C1's PROPOSAL docs/contracts/lead-finder-sweep.md). `mock` = made-up searches kept in ONE cookie of the browser (nothing is searched, nothing is sent, nobody is called:
 * the page says so); the mock refuses what the API would refuse (the same codes, so the screens' sentences are the same ones). `on` = C1's API once it exists; `off` = the part is not there. SERVER ONLY.
 */
export const MOCK_COOKIE = "sme_sweeps_mock";
const COOKIE_MAX = 3500;
const MAX_SWEEPS = 5;
const KEEP_RUNS = 4;
const WEEK_MS = 7 * 24 * 3_600_000;
export type Ctx = { token: string; tenantId: string };
export type SweepRead = { mode: "off" } | { mode: "unavailable" } | ({ mode: "ok"; demo: boolean; runs: Record<string, SweepRun[]> } & SweepList);

// ---- the mock's state, compact: a run is [state 0 done / 1 failed / 2 skipped, found, new, duplicates, needsOwner, skipped, byOwner 0/1, started (seconds since 1970)]
type Tuple = [number, number, number, number, number, number, number, number];
type Kept = { i: string; q: string; a: string; w: number; h: number; m: number; e: 0 | 1; c: number; r: Tuple[] };
type State = { v: 1; s: Kept[] };
const STATES: RunState[] = ["done", "failed", "skipped"];

const FIRST = "5e1e0000-0000-4000-8000-00000000000";
/** Before anyone has changed anything: two made-up weekly searches with a few weeks behind them, so the screen is worth looking at. */
function starting(now: number): State {
  const week = (w: number, h: number, k: number) => nextRunMs(w, h, now) - k * WEEK_MS;
  const t = (ms: number) => Math.floor(ms / 1000);
  return {
    v: 1,
    s: [
      { i: `${FIRST}1`, q: "saree shops", a: "Jayanagar Bengaluru", w: 1, h: 7, m: 20, e: 1, c: t(week(1, 7, 3)), r: [[0, 20, 6, 14, 6, 0, 0, t(week(1, 7, 1))], [0, 20, 3, 17, 3, 0, 0, t(week(1, 7, 2))], [2, 0, 0, 0, 0, 0, 0, t(week(1, 7, 3))]] },
      { i: `${FIRST}2`, q: "boutiques", a: "Malleshwaram Bengaluru", w: 3, h: 8, m: 10, e: 0, c: t(week(3, 8, 3)), r: [[0, 10, 2, 8, 2, 0, 0, t(week(3, 8, 2))]] },
    ],
  };
}
const kept = (v: unknown): State | null => {
  if (typeof v !== "object" || v === null || (v as State).v !== 1 || !Array.isArray((v as State).s)) return null;
  const s = (v as State).s.filter((x) => x && typeof x.i === "string" && typeof x.q === "string" && typeof x.a === "string" && Number.isInteger(x.w) && Number.isInteger(x.h) && Number.isInteger(x.m) && Array.isArray(x.r)).slice(0, MAX_SWEEPS);
  return { v: 1, s };
};
async function loadMock(now: number): Promise<State> {
  try {
    const raw = (await cookies()).get(MOCK_COOKIE)?.value;
    const own = raw ? kept(JSON.parse(raw)) : null;
    if (own) return own;
  } catch {
    // not JSON: the made-up start is used
  }
  return starting(now);
}
async function saveMock(state: State): Promise<void> {
  const text = JSON.stringify(state);
  if (text.length > COOKIE_MAX) throw new ApiRequestError(409, "sweep_limit_reached", "Too many weekly searches for the test mode.");
  (await cookies()).set(MOCK_COOKIE, text, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 30, path: "/" });
}

const iso = (ms: number) => new Date(ms).toISOString();
const runId = (sweepId: string, k: number) => `${sweepId.slice(0, -4)}${(k % 0xffff).toString(16).padStart(4, "0")}`;
function runOf(k: Kept, r: Tuple, idx: number): SweepRun {
  const [st, found, fresh, dup, needs, skipped, owner, at] = r;
  const state = STATES[st] ?? "done";
  return {
    id: runId(k.i, at + idx),
    sweepId: k.i,
    state,
    skipReason: state === "skipped" ? "budget" : null,
    searchId: state === "done" ? runId(k.i, at + idx + 1) : null,
    startedAt: iso(at * 1000),
    finishedAt: state === "done" ? iso(at * 1000 + 40_000) : null,
    costPaise: 0,
    counts: state === "done" ? { found, new: fresh, duplicates: dup, callReady: 0, needsOwner: needs, skipped } : null,
    newSinceLastRun: state === "done" ? fresh : 0,
    trigger: owner === 1 ? "owner" : "schedule",
  };
}
const runsOf = (k: Kept): SweepRun[] => k.r.map((r, i) => runOf(k, r, i)).sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, KEEP_RUNS);
function sweepOf(k: Kept, now: number): Sweep {
  const runs = runsOf(k);
  return {
    id: k.i,
    query: k.q,
    area: k.a,
    maxResults: k.m,
    weekday: k.w,
    hour: k.h,
    enabled: k.e === 1,
    provider: "fixture",
    estCostPaise: 0,
    costIsEstimate: false,
    attribution: null,
    nextRunAt: k.e === 1 ? iso(nextRunMs(k.w, k.h, now)) : null,
    lastRun: runs[0] ?? null,
    createdAt: iso(k.c * 1000),
  };
}
/** "find new retailers in Jayanagar": what to look for, then where (the plan card's own two parts); with no "in", the words are the search and the area is a made-up one. */
function split(words: string): { q: string; a: string } {
  const text = words.trim().replace(/\s+/g, " ");
  const m = /^(.*?)\s+(?:in|near|around)\s+(.+)$/i.exec(text);
  const clip = (s: string) => s.slice(0, 60);
  const q = (m ? m[1] : text).replace(/^(find|search for|look for)\s+(new\s+)?/i, "");
  return { q: clip(q.length >= 2 ? q : text), a: clip(m ? m[2] : "your area") };
}
const notFound = () => new ApiRequestError(404, "not_found", "Not found.");

export async function readSweeps(ctx: Ctx, now: number = Date.now()): Promise<SweepRead> {
  const mode = sweepScreens();
  if (mode === "off") return { mode: "off" };
  if (mode === "on") {
    try {
      const list = await listSweeps(ctx.token, ctx.tenantId);
      const runs = Object.fromEntries(await Promise.all(list.items.map(async (s) => [s.id, await listSweepRuns(ctx.token, ctx.tenantId, s.id, KEEP_RUNS).catch(() => [])] as const)));
      return { mode: "ok", demo: false, runs, ...list };
    } catch {
      return { mode: "unavailable" };
    }
  }
  const st = await loadMock(now);
  const items = st.s.map((k) => sweepOf(k, now));
  const list = parseSweepList({ items: items.map(wire), max_sweeps: MAX_SWEEPS, weekly_budget_paise: 0 }) ?? { items, maxSweeps: MAX_SWEEPS, weeklyBudgetPaise: 0 };
  return { mode: "ok", demo: true, runs: Object.fromEntries(st.s.map((k) => [k.i, runsOf(k)])), ...list };
}

/** A sweep in the contract's own words (snake_case), so the mock goes through the same parser as the API does. */
function wire(s: Sweep): Record<string, unknown> {
  const r = s.lastRun;
  return {
    id: s.id, query: s.query, area: s.area, max_results: s.maxResults, weekday: s.weekday, hour: s.hour, enabled: s.enabled, provider: s.provider, est_cost_paise: s.estCostPaise, cost_is_estimate: s.costIsEstimate, attribution: s.attribution, next_run_at: s.nextRunAt, created_at: s.createdAt,
    last_run: r && { id: r.id, sweep_id: r.sweepId, state: r.state, skip_reason: r.skipReason, search_id: r.searchId, started_at: r.startedAt, finished_at: r.finishedAt, cost_paise: r.costPaise, counts: r.counts && { found: r.counts.found, new: r.counts.new, duplicates: r.counts.duplicates, call_ready: r.counts.callReady, needs_owner: r.counts.needsOwner, skipped: r.counts.skipped }, new_since_last_run: r.newSinceLastRun, trigger: r.trigger },
  };
}

/** The card before the OK: nothing is stored. The mock answers what a made-up search would (no cost; the same refusals as create: the most weekly searches, an input the API would refuse). */
export async function previewNew(ctx: Ctx, input: SweepInput, now: number = Date.now()): Promise<SweepPreview> {
  const mode = sweepScreens();
  if (mode === "off") throw notFound();
  if (mode === "on") return previewSweep(ctx.token, ctx.tenantId, input);
  if (sweepProblem(input)) throw new ApiRequestError(422, "validation_error", "Invalid.");
  const st = await loadMock(now);
  if (st.s.length >= MAX_SWEEPS) throw new ApiRequestError(409, "sweep_limit_reached", "Too many weekly searches.");
  const { q, a } = split(input.text);
  const out = parseSweepPreview({ query: q, area: a, max_results: input.maxResults, weekday: input.weekday, hour: input.hour, provider: "fixture", est_cost_paise: 0, cost_is_estimate: false, attribution: null, next_run_at: iso(nextRunMs(input.weekday, input.hour, now)), weekly_budget_paise: 0, budget_left_paise: 0, fits_budget: true, sweeps_used: st.s.length, max_sweeps: MAX_SWEEPS });
  if (!out) throw new ApiRequestError(422, "validation_error", "Invalid.");
  return out;
}

/** The API's refusals are thrown (ApiRequestError); the mock throws the same ones. */
export async function addSweep(ctx: Ctx, input: SweepInput, now: number = Date.now()): Promise<Sweep> {
  const mode = sweepScreens();
  if (mode === "off") throw notFound();
  if (mode === "on") return createSweep(ctx.token, ctx.tenantId, input);
  if (sweepProblem(input)) throw new ApiRequestError(422, "validation_error", "Invalid.");
  const st = await loadMock(now);
  if (st.s.length >= MAX_SWEEPS) throw new ApiRequestError(409, "sweep_limit_reached", "Too many weekly searches.");
  const { q, a } = split(input.text);
  const k: Kept = { i: randomUUID(), q, a, w: input.weekday, h: input.hour, m: input.maxResults, e: 1, c: Math.floor(now / 1000), r: [] };
  await saveMock({ v: 1, s: [...st.s, k] });
  return parseSweep(wire(sweepOf(k, now))) ?? sweepOf(k, now);
}

export async function editSweep(ctx: Ctx, sweepId: string, change: SweepChange, now: number = Date.now()): Promise<Sweep> {
  const mode = sweepScreens();
  if (mode === "off") throw notFound();
  if (mode === "on") return changeSweep(ctx.token, ctx.tenantId, sweepId, change);
  const st = await loadMock(now);
  const k = st.s.find((x) => x.i === sweepId);
  if (!k) throw notFound();
  if (change.weekday !== undefined) k.w = change.weekday;
  if (change.hour !== undefined) k.h = change.hour;
  if (change.maxResults !== undefined) k.m = change.maxResults;
  if (change.enabled !== undefined) k.e = change.enabled ? 1 : 0;
  await saveMock(st);
  return sweepOf(k, now);
}

export async function runNow(ctx: Ctx, sweepId: string, now: number = Date.now()): Promise<SweepRun> {
  const mode = sweepScreens();
  if (mode === "off") throw notFound();
  if (mode === "on") return runSweepNow(ctx.token, ctx.tenantId, sweepId);
  const st = await loadMock(now);
  const k = st.s.find((x) => x.i === sweepId);
  if (!k) throw notFound();
  const found = Math.min(k.m, 8 + (k.q.length % 9)); // made up, the same for the same words
  const dup = Math.floor(found * 0.3);
  const fresh = found - dup;
  const needs = Math.min(fresh, 10);
  const tuple: Tuple = [0, found, fresh, dup, needs, fresh - needs, 1, Math.floor(now / 1000)];
  k.r = [...k.r, tuple].slice(-KEEP_RUNS);
  await saveMock(st);
  return runOf(k, tuple, k.r.length - 1);
}

export async function dropSweep(ctx: Ctx, sweepId: string, now: number = Date.now()): Promise<void> {
  const mode = sweepScreens();
  if (mode === "off") throw notFound();
  if (mode === "on") return removeSweep(ctx.token, ctx.tenantId, sweepId);
  const st = await loadMock(now);
  await saveMock({ v: 1, s: st.s.filter((x) => x.i !== sweepId) }); // a second remove is the same answer
}
