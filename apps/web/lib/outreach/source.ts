import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import * as api from "@/lib/api/outreach";
import { readJar, writeJar } from "@/lib/mock/jar";
import { outreachScreens } from "@/lib/screens/flag";

import { EMPTY, MOCK_COOKIE, MOCK_POLICY, answerOf, handoffsOf, itemsOf, newBatch, newRule, parse, planHash, reportOf, ruleOf, type MockState } from "./mock";
import type { BatchAnswer, BatchInput, BatchItem, Done, Handoff, OutreachReport, Policy, Refusal, Rule, RuleInput } from "./types";

/**
 * Where the speed-to-lead screens get their data and send their changes (night 4, part A3). `mock` = lib/outreach/mock.ts (a cookie, nothing is sent), `on` = C1's API (lib/api/outreach.ts), `off` = the screens are not there. SERVER ONLY.
 * A read that fails is `null` ("Not available yet"); a change answers `{ok:true,value}` or `{ok:false,error}` in the closed words of `Refusal`. An expired sign-in is NOT swallowed: `ApiAuthError` goes up so the page can send the person to sign in.
 */
export type Ctx = { token: string; tenantId: string; userId: string };
export const outreachMode = outreachScreens;

/** The API's refusals in the words the screens know. */
export function refusalOf(error: unknown): Refusal {
  if (error instanceof ApiAuthError) throw error;
  if (error instanceof ApiRequestError) {
    if (error.code === "mfa_required") return "mfa";
    if (error.code === "not_for_schools") return "not_for_schools";
    if (error.code === "plan_changed") return "changed";
    if (error.code === "workspace_read_only") return "read_only";
    if (error.code === "outreach_state") return "state";
    if (error.status === 403) return "forbidden";
    if (error.status === 422 || error.status === 400) return "invalid";
    if (error.status === 404) return "not_available";
  }
  return "down";
}

const state = () => readJar(MOCK_COOKIE, parse, EMPTY);
const keep = async (s: MockState): Promise<boolean> => writeJar(MOCK_COOKIE, s, 7);
const attempt = async <T>(run: () => Promise<T>): Promise<Done<T>> => {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    return { ok: false, error: refusalOf(error) };
  }
};
const off = <T>(): Done<T> => ({ ok: false, error: "not_available" });

export async function readBatches(ctx: Ctx, now: Date = new Date()): Promise<BatchAnswer[] | null> {
  const mode = outreachMode();
  if (mode === "off") return null;
  if (mode === "mock") return (await state()).batches.map((b) => answerOf(b, now)).reverse();
  try {
    return await api.listBatches(ctx.token, ctx.tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return null;
  }
}

export async function readBatch(ctx: Ctx, batchId: string, now: Date = new Date()): Promise<BatchAnswer | null> {
  const mode = outreachMode();
  if (mode === "off") return null;
  if (mode === "mock") {
    const b = (await state()).batches.find((x) => x.id === batchId);
    return b ? answerOf(b, now) : null;
  }
  try {
    return await api.getBatch(ctx.token, ctx.tenantId, batchId);
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return null;
  }
}

export async function readItems(ctx: Ctx, batchId: string, cursor: string | null = null, now: Date = new Date()): Promise<{ items: BatchItem[]; nextCursor: string | null } | null> {
  const mode = outreachMode();
  if (mode === "off") return null;
  if (mode === "mock") {
    const b = (await state()).batches.find((x) => x.id === batchId);
    return b ? { items: itemsOf(b, now), nextCursor: null } : null;
  }
  try {
    return await api.getBatchItems(ctx.token, ctx.tenantId, batchId, cursor);
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return null;
  }
}

/** The draft plan of a batch (nothing is called or sent): one approval comes after, on the plan. */
export async function makeBatch(ctx: Ctx, input: BatchInput, now: Date = new Date()): Promise<Done<BatchAnswer>> {
  const mode = outreachMode();
  if (mode === "off") return off();
  if (mode === "mock") {
    const s = await state();
    if (s.batches.some((b) => b.id === input.batchId)) return { ok: true, value: answerOf(s.batches.find((b) => b.id === input.batchId)!, now) };
    const b = newBatch(input, now);
    if (!(await keep({ ...s, batches: [...s.batches.slice(-5), b] }))) return { ok: false, error: "invalid" };
    return { ok: true, value: answerOf(b, now) };
  }
  return attempt(() => api.planBatch(ctx.token, ctx.tenantId, input));
}

/** Leave people out of a plan that is still waiting (the plan's hash changes with them). */
export async function excludeContacts(ctx: Ctx, batchId: string, contactIds: readonly string[], excluded: boolean, now: Date = new Date()): Promise<Done<BatchAnswer>> {
  const mode = outreachMode();
  if (mode === "off") return off();
  if (mode === "mock") {
    const s = await state();
    const b = s.batches.find((x) => x.id === batchId);
    if (!b || b.approvedAt) return { ok: false, error: "state" };
    const set = new Set(b.excluded);
    for (const id of contactIds) {
      if (excluded) set.add(id);
      else set.delete(id);
    }
    const next = { ...b, excluded: [...set].slice(0, 40) };
    if (!(await keep({ ...s, batches: s.batches.map((x) => (x.id === batchId ? next : x)) }))) return { ok: false, error: "invalid" };
    return { ok: true, value: answerOf(next, now) };
  }
  // the API has one verb for leaving people out; taking someone back in is a new plan (the contract has no "include")
  if (!excluded) return { ok: false, error: "state" };
  return attempt(() => api.excludeFromBatch(ctx.token, ctx.tenantId, batchId, contactIds));
}

/** ONE approval for everybody who is not left out: the hash binds it to exactly what was shown. */
export async function approve(ctx: Ctx, batchId: string, planSha256: string, now: Date = new Date()): Promise<Done<BatchAnswer>> {
  const mode = outreachMode();
  if (mode === "off") return off();
  if (mode === "mock") {
    const s = await state();
    const b = s.batches.find((x) => x.id === batchId);
    if (!b || b.approvedAt || b.cancelled) return { ok: false, error: "state" };
    if (planHash(b) !== planSha256) return { ok: false, error: "changed" };
    const next = { ...b, approvedAt: now.toISOString() };
    if (!(await keep({ ...s, batches: s.batches.map((x) => (x.id === batchId ? next : x)) }))) return { ok: false, error: "invalid" };
    return { ok: true, value: answerOf(next, now) };
  }
  return attempt(() => api.approveBatch(ctx.token, ctx.tenantId, batchId, planSha256));
}

export async function controlBatch(ctx: Ctx, batchId: string, action: "pause" | "resume" | "cancel", now: Date = new Date()): Promise<Done<BatchAnswer>> {
  const mode = outreachMode();
  if (mode === "off") return off();
  if (mode === "mock") {
    const s = await state();
    const b = s.batches.find((x) => x.id === batchId);
    if (!b || !b.approvedAt || b.cancelled) return { ok: false, error: "state" };
    const next = action === "cancel" ? { ...b, cancelled: true } : { ...b, paused: action === "pause" };
    if (!(await keep({ ...s, batches: s.batches.map((x) => (x.id === batchId ? next : x)) }))) return { ok: false, error: "invalid" };
    return { ok: true, value: answerOf(next, now) };
  }
  return attempt(() => api.batchAction(ctx.token, ctx.tenantId, batchId, action));
}

export async function readRules(ctx: Ctx, now: Date = new Date()): Promise<Rule[] | null> {
  const mode = outreachMode();
  if (mode === "off") return null;
  if (mode === "mock") return (await state()).rules.map((r) => ruleOf(r, now));
  try {
    return await api.listRules(ctx.token, ctx.tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return null;
  }
}

/** A standing rule: approved ONCE by the Owner (second factor), then nobody clicks per lead. */
export async function saveRule(ctx: Ctx, input: RuleInput, now: Date = new Date()): Promise<Done<Rule>> {
  const mode = outreachMode();
  if (mode === "off") return off();
  if (mode === "mock") {
    const s = await state();
    const mine = newRule(input, now);
    if (s.rules.some((r) => r.source === input.source && r.active)) return { ok: false, error: "state" };
    if (!(await keep({ ...s, rules: [...s.rules.slice(-5), mine] }))) return { ok: false, error: "invalid" };
    return { ok: true, value: ruleOf(mine, now) };
  }
  return attempt(() => api.createRule(ctx.token, ctx.tenantId, input));
}

export async function controlRule(ctx: Ctx, ruleId: string, action: "pause" | "resume", now: Date = new Date()): Promise<Done<Rule>> {
  const mode = outreachMode();
  if (mode === "off") return off();
  if (mode === "mock") {
    const s = await state();
    const r = s.rules.find((x) => x.id === ruleId);
    if (!r) return { ok: false, error: "state" };
    const next = { ...r, active: action === "resume", pausedReason: action === "pause" ? ("owner" as const) : null };
    if (!(await keep({ ...s, rules: s.rules.map((x) => (x.id === ruleId ? next : x)) }))) return { ok: false, error: "invalid" };
    return { ok: true, value: ruleOf(next, now) };
  }
  return attempt(() => api.ruleAction(ctx.token, ctx.tenantId, ruleId, action));
}

export async function readHandoffs(ctx: Ctx, open = true, now: Date = new Date()): Promise<Handoff[] | null> {
  const mode = outreachMode();
  if (mode === "off") return null;
  if (mode === "mock") return handoffsOf(await state(), ctx.userId, now, open);
  try {
    return await api.listHandoffs(ctx.token, ctx.tenantId, open);
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return null;
  }
}

export async function markActed(ctx: Ctx, handoffId: string): Promise<Done<true>> {
  const mode = outreachMode();
  if (mode === "off") return off();
  if (mode === "mock") {
    const s = await state();
    if (!(await keep({ ...s, acted: [...new Set([...s.acted, handoffId])].slice(-20) }))) return { ok: false, error: "invalid" };
    return { ok: true, value: true };
  }
  return attempt(async () => {
    await api.markHandoffActed(ctx.token, ctx.tenantId, handoffId);
    return true as const;
  });
}

export async function readReport(ctx: Ctx, from: string, to: string): Promise<OutreachReport | null> {
  const mode = outreachMode();
  if (mode === "off") return null;
  if (mode === "mock") return reportOf(from, to);
  try {
    return await api.getOutreachReport(ctx.token, ctx.tenantId, from, to);
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return null;
  }
}

export async function readPolicy(ctx: Ctx): Promise<Policy | null> {
  const mode = outreachMode();
  if (mode === "off") return null;
  if (mode === "mock") return MOCK_POLICY;
  try {
    return await api.getPolicy(ctx.token, ctx.tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return null;
  }
}


