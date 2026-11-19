import { ApiAuthError, ApiRequestError, apiRequest } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { readJar, writeJar } from "@/lib/mock/jar";
import { readBillingBalance } from "@/lib/billing-v6/source";
import { readState } from "@/lib/billing-v6/mock-state";
import { formatRupeesShort } from "@/lib/money";
import { planKeyOf, planName, type PlanKey } from "@/lib/plan/names";
import { EXTRA_NUMBER_PAISE, MINUTE_PAISE, NUMBERS_INCLUDED, PLAN_TERMS } from "@/lib/plan/plans-v2";
import { billingV2 } from "@/lib/screens/flag";

import { demoMonth, demoSpend, isDemo, type Demo } from "./wallet-fixtures";

/**
 * THE ONE ADAPTER of the wallet screen (BILLING_V2). Everything the Billing page shows about money passes through here, so C1's routes (proposed in `~/Desktop/stack19-jobs/contracts/wallet-web-needs.md`) are read by ONE parser and changing them means editing this file.
 *
 * Real today (BILLING_V2=1): the balance, the plan, the included minutes and what is left of them (`GET /billing/balance`, lib/billing-v6/source.ts), and the free start. NOT real yet, behind this adapter: the usage line of each feature
 * (`GET /billing/usage`), the spending limits (`PUT /billing/limits/{feature}`) and a real top-up (the top-up button is the existing sheet; its payment is Razorpay TEST once C1's orders are wired). While `GET /billing/usage` is not there (404) or unreadable the page shows only the
 * lines it can make from the real balance (calls) and says the rest comes soon; `limitsAvailable` is false and no limit can be set. BILLING_V2=mock = every number made up (lib/api/wallet-fixtures.ts), limits kept in a cookie.
 *
 * Words are CLOSED: the API sends feature, unit and warn as codes, never prose; the screen's sentences are `bill.*` in i18n/strings/app.json. Money is integer paise; a halved minute is a half (calls are billed every 30 seconds). SERVER ONLY.
 */
export const FEATURES = ["calls", "numbers", "find_customers", "whatsapp"] as const;
export type Feature = (typeof FEATURES)[number];
/** The features an owner may put a spending limit on (a number is a fixed monthly price, so it has none). */
export const LIMITABLE = ["calls", "find_customers", "whatsapp"] as const;
export type LimitFeature = (typeof LIMITABLE)[number];
export const UNITS = ["minute", "number", "search", "message"] as const;
export type Unit = (typeof UNITS)[number];
export const WARNS = ["none", "at80", "at100"] as const;
export type Warn = (typeof WARNS)[number];

const UNIT_OF: Record<Feature, Unit> = { calls: "minute", numbers: "number", find_customers: "search", whatsapp: "message" };

export type UsageLine = {
  feature: Feature;
  unit: Unit;
  /** Minutes, numbers, searches or messages used this month. */
  used: number;
  /** What the plan includes of it (calls: the plan's minutes, numbers: 1, searches: the free ones); null when nothing is included (WhatsApp). */
  included: number | null;
  /** The price of one beyond the included ones (a minute, a number a month, a search); null for WhatsApp (Meta's own cost). */
  unitPaise: number | null;
  /** What this feature took from the wallet this month. */
  spentPaise: number;
  /** The owner's spending limit for the month, or null. */
  limitPaise: number | null;
  warn: Warn;
  /** The limit was reached: the feature is stopped for the month. */
  paused: boolean;
};

export type Wallet = {
  /** `api`: the usage route answered; `balance`: only the real balance (the usage route is not there yet); `mock`: made up. */
  source: "api" | "balance" | "mock";
  balancePaise: number;
  minutesEstimate: number | null;
  /** C1's own "low" (under about 20 minutes of calling). */
  low: boolean;
  planId: string | null;
  planKey: PlanKey | null;
  planName: string | null;
  planRenews: string | null;
  topupAvailable: boolean;
  freeStartGranted: boolean;
  freeStartLeftText: string | null;
  /** Day of the billing month and its length; null when not known. */
  day: number | null;
  days: number | null;
  lines: UsageLine[];
  /** A spending limit can be saved (the API route exists, or the mock). */
  limitsAvailable: boolean;
};

const MAX = 100_000_000_00;
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const whole = (v: unknown, max = MAX): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= max ? v : null);
/** A count that may be a half (billing per 30 seconds). */
const half = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 10_000_000 && Math.round(v * 2) === v * 2 ? v : null);
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : null);

/** The 80% and 100% marks. With a spending limit they are of the money spent against the limit; else of the included minutes or free searches. WhatsApp and numbers with no limit never warn. */
export function deriveWarn(line: Pick<UsageLine, "feature" | "used" | "included" | "spentPaise" | "limitPaise">): { warn: Warn; paused: boolean } {
  if (line.limitPaise !== null && line.limitPaise > 0) {
    const share = line.spentPaise / line.limitPaise;
    if (share >= 1) return { warn: "at100", paused: true };
    return { warn: share >= 0.8 ? "at80" : "none", paused: false };
  }
  if ((line.feature === "calls" || line.feature === "find_customers") && line.included !== null && line.included > 0) {
    const share = line.used / line.included;
    if (share >= 1) return { warn: "at100", paused: false };
    return { warn: share >= 0.8 ? "at80" : "none", paused: false };
  }
  return { warn: "none", paused: false };
}

function parseLine(raw: unknown): UsageLine | null {
  if (!isRec(raw)) return null;
  const feature = oneOf(FEATURES, raw.feature);
  if (feature === null) return null; // a feature of a newer API: not drawn, never a made-up name
  const used = half(raw.used);
  const spentPaise = whole(raw.spent_paise);
  const included = raw.included === null || raw.included === undefined ? null : half(raw.included);
  const unitPaise = raw.unit_paise === null || raw.unit_paise === undefined ? null : whole(raw.unit_paise);
  const limitPaise = raw.limit_paise === null || raw.limit_paise === undefined ? null : whole(raw.limit_paise);
  if (used === null || spentPaise === null || (raw.included != null && included === null)) return null;
  if ((raw.unit_paise != null && unitPaise === null) || (raw.limit_paise != null && limitPaise === null)) return null;
  const unit = oneOf(UNITS, raw.unit) ?? UNIT_OF[feature];
  const base = { feature, unit, used, included, unitPaise, spentPaise, limitPaise: feature === "numbers" ? null : limitPaise };
  const given = oneOf(WARNS, raw.warn);
  const derived = deriveWarn(base);
  return { ...base, warn: given ?? derived.warn, paused: typeof raw.paused === "boolean" ? raw.paused : derived.paused };
}

/** C1's `GET /billing/usage` answer: `{period: {day, days}, lines: [...]}`; null when it is not one the screen can trust. */
export function parseUsage(json: unknown): { day: number | null; days: number | null; lines: UsageLine[] } | null {
  if (!isRec(json) || !Array.isArray(json.lines) || json.lines.length > 12) return null;
  const lines: UsageLine[] = [];
  for (const raw of json.lines) {
    if (isRec(raw) && oneOf(FEATURES, raw.feature) === null) continue;
    const line = parseLine(raw);
    if (line === null) return null;
    if (!lines.some((l) => l.feature === line.feature)) lines.push(line);
  }
  const p = isRec(json.period) ? json.period : {};
  const day = whole(p.day, 366);
  const days = whole(p.days, 366);
  return { day: day !== null && day >= 1 ? day : null, days: days !== null && days >= 1 ? days : null, lines };
}

const callsLine = (included: number | null, left: number | null): UsageLine | null => {
  if (included === null || left === null) return null;
  const base = { feature: "calls" as const, unit: "minute" as const, used: Math.max(0, included - left), included, unitPaise: MINUTE_PAISE, spentPaise: 0, limitPaise: null };
  return { ...base, ...deriveWarn(base) };
};

/** ---- the MOCK (BILLING_V2=mock): limits chosen on the screen are kept in this browser's cookie ---- */
const LIMITS_COOKIE = "sme_wallet_mock";
type MockLimits = Partial<Record<LimitFeature, number | null>>;
const parseLimits = (v: unknown): MockLimits | null => {
  if (!isRec(v)) return null;
  const out: MockLimits = {};
  for (const f of LIMITABLE) {
    const x = v[f];
    if (x === null) out[f] = null;
    else if (typeof x === "number" && Number.isSafeInteger(x) && x >= 10_000 && x <= 100_000_000) out[f] = x;
  }
  return out;
};

export function mockWallet(demo: Demo, limits: MockLimits): Wallet {
  const m = demoMonth(demo);
  const t = PLAN_TERMS[m.planKey];
  const spend = demoSpend(m);
  const limit = (f: LimitFeature): number | null => (f in limits ? (limits[f] ?? null) : (m.limits[f] ?? null));
  const make = (feature: Feature, used: number, included: number | null, unitPaise: number | null, spentPaise: number): UsageLine => {
    const limitPaise = feature === "numbers" ? null : limit(feature as LimitFeature);
    const base = { feature, unit: UNIT_OF[feature], used, included, unitPaise, spentPaise, limitPaise };
    return { ...base, ...deriveWarn(base) };
  };
  const paise = m.balancePaise;
  return {
    source: "mock",
    balancePaise: paise,
    minutesEstimate: Math.floor(paise / MINUTE_PAISE),
    low: m.low,
    planId: m.planId,
    planKey: m.planKey,
    planName: planName(m.planId),
    planRenews: "2026-12-13T05:00:00Z",
    topupAvailable: true,
    freeStartGranted: true,
    freeStartLeftText: null,
    day: m.day,
    days: m.days,
    limitsAvailable: true,
    lines: [
      make("calls", m.minutes, t.includedMinutes > 0 ? t.includedMinutes : null, MINUTE_PAISE, spend.calls),
      make("numbers", m.numbers, NUMBERS_INCLUDED, EXTRA_NUMBER_PAISE, spend.numbers),
      make("find_customers", m.searches, t.freeSearches, t.searchPaise, spend.find_customers),
      make("whatsapp", m.whatsappMessages, null, null, spend.whatsapp),
    ],
  };
}

/** The wallet of this business (null = billing could not be read). `demo` is the page's ?demo= (mock only). */
export async function readWallet(token: string, tenantId: string, demo: string | null = null): Promise<Wallet | null> {
  const mode = billingV2();
  if (mode === "off" || !isCanonicalUuid(tenantId)) return null;
  if (mode === "mock") {
    const limits = await readJar(LIMITS_COOKIE, parseLimits, {});
    // the test top-ups made on this screen (the sheet's own cookie state) are added to the made-up balance, so a top-up is seen
    const added = (await readState()).topups.reduce((sum, t) => sum + t.paise, 0);
    const wallet = mockWallet(isDemo(demo) ? demo : "normal", limits);
    const paise = wallet.balancePaise + added;
    return { ...wallet, balancePaise: paise, minutesEstimate: Math.floor(paise / MINUTE_PAISE) };
  }
  const balance = await readBillingBalance(token, tenantId);
  if (balance === null) return null;
  const planKey = planKeyOf(balance.planId);
  const head = {
    balancePaise: balance.paise,
    minutesEstimate: balance.minutesEstimate,
    low: balance.low,
    planId: balance.planId,
    planKey,
    planName: balance.planName,
    planRenews: balance.subscription?.periodEnd ?? null,
    topupAvailable: balance.topupAvailable,
    freeStartGranted: balance.freeStartGranted,
    freeStartLeftText: balance.freeStartLeftText,
  };
  try {
    const usage = parseUsage(await apiRequest(`/v1/tenants/${tenantId}/billing/usage`, token));
    if (usage !== null) return { ...head, source: "api", day: usage.day, days: usage.days, lines: usage.lines, limitsAvailable: true };
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    // 404 (the route is not there yet) or any other failure: the part that is real is shown, the rest is said to be coming
  }
  const calls = callsLine(balance.includedMinutes, balance.includedMinutesLeft);
  return { ...head, source: "balance", day: null, days: null, lines: calls ? [calls] : [], limitsAvailable: false };
}

export type LimitResult = { ok: true } | { ok: false; error: "not_available" | "invalid" | "forbidden" | "down" };

/** The owner's spending limit of one feature for the month: paise, or null for no limit. */
export async function saveLimit(token: string, tenantId: string, feature: unknown, limitPaise: unknown): Promise<LimitResult> {
  const mode = billingV2();
  if (mode === "off" || !isCanonicalUuid(tenantId)) return { ok: false, error: "not_available" };
  const f = oneOf(LIMITABLE, feature);
  const amount = limitPaise === null ? null : whole(limitPaise, 100_000_000);
  if (f === null || (limitPaise !== null && (amount === null || amount < 10_000))) return { ok: false, error: "invalid" };
  if (mode === "mock") {
    const now = await readJar(LIMITS_COOKIE, parseLimits, {});
    return (await writeJar(LIMITS_COOKIE, { ...now, [f]: amount })) ? { ok: true } : { ok: false, error: "invalid" };
  }
  try {
    await apiRequest(`/v1/tenants/${tenantId}/billing/limits/${f}`, token, { method: "PUT", body: JSON.stringify({ limit_paise: amount }) });
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    if (error instanceof ApiRequestError && error.status === 403) return { ok: false, error: "forbidden" };
    if (error instanceof ApiRequestError && (error.status === 404 || error.status === 405)) return { ok: false, error: "not_available" };
    if (error instanceof ApiRequestError && error.status === 422) return { ok: false, error: "invalid" };
    return { ok: false, error: "down" };
  }
}

/** The text of a limit option ("₹2,000"). */
export const limitText = (paise: number): string => formatRupeesShort(paise);
