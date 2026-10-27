import { CATALOGUE } from "@/lib/plan/catalogue";
import type { PlanCatalogue, PlanDef } from "@/lib/plan/types";

import { istDay, monthPeriod, projectRunOut } from "./logic";
import type { Balance, Invoice, Kind, Meter, Pack, Purchase, SettingsInput, TopupError, TopupSettings, TopupsView, UpgradePreview, UsageView } from "./types";

/**
 * The FAKE provider of the top-up screens (TOPUP_SCREENS=mock): everything the API of job E2 does, small enough to live in ONE cookie of the browser (lib/mock/jar.ts) and be read with allow-lists on every request. Nothing is sent, no
 * money moves, no card number exists. The AMOUNTS in this file are TEST amounts for review (the owner of the product has set no prices): the screens show them only in test mode and call them "test price". The maths of GST and
 * of the pro-rata upgrade below are the MOCK'S own copies, clearly separate: with TOPUP_SCREENS=1 the API does them and the screens only write down what it answers (the model never calculates money).
 */
export const MOCK_COOKIE = "sme_topups_mock";
export const TOPUP_VALID_DAYS = 90;
/** The leads whose call waits while the minutes are used up (a fixed figure in test mode: there are no real leads here). */
export const MOCK_QUEUED_CALLS = 12;
const MOCK_QUEUED_MESSAGES = 6;

type PackSpec = { code: string; kind: Kind; units: number; pricePaise: number };
/** TEST amounts (GST-exclusive paise), not a price list. */
export const MOCK_PACKS: readonly PackSpec[] = [
  { code: "minutes_100", kind: "call_minutes", units: 100, pricePaise: 40_000 },
  { code: "minutes_300", kind: "call_minutes", units: 300, pricePaise: 108_000 },
  { code: "minutes_1000", kind: "call_minutes", units: 1000, pricePaise: 320_000 },
  { code: "messages_100", kind: "whatsapp_messages", units: 100, pricePaise: 7_000 },
  { code: "messages_300", kind: "whatsapp_messages", units: 300, pricePaise: 18_000 },
  { code: "messages_1000", kind: "whatsapp_messages", units: 1000, pricePaise: 55_000 },
];
const GST_BP = 1800;
const OVERAGE_RATE: Record<Kind, number> = { call_minutes: 500, whatsapp_messages: 70 };
/** TEST monthly amounts of the plans, used ONLY to show the pro-rata difference in test mode. */
const TEST_MONTHLY_PAISE: Record<string, number> = { starter: 99_900, growth: 249_900, business: 599_900, calls_300: 149_900, calls_1000: 399_900 };
/** The plan test mode starts on: the first calls-only plan with a minutes allowance (read from the catalogue, never named here). */
const DEFAULT_PLAN = CATALOGUE.plans.find((p) => p.kind === "calls" && p.callMinutes !== null)?.id ?? CATALOGUE.plans[0].id;
const planDef = (id: string | null, cat: PlanCatalogue): PlanDef | null => (id === null ? null : (cat.plans.find((p) => p.id === id) ?? null));

// ---- the state (ONE small cookie) ----
type LotEntry = { i: string; c: string; t: string; r: "m" | "a"; n: number };
type UpEntry = { p: string; t: string; n: number; x: number };
export type MockState = {
  v: 1;
  /** First day of the period the usage belongs to; a new month starts the counts again. */
  ps: string;
  /** Used minutes / messages; null = the review default (about four fifths of minutes). */
  um: number | null;
  ug: number | null;
  /** The plan the business upgraded to in test mode (null = the plan the Plan part shows, or the default). */
  plan: string | null;
  lots: LotEntry[];
  ups: UpEntry[];
  /** Invoice counter. */
  n: number;
  am: string | null;
  ag: string | null;
  acap: number;
  aspent: number;
  om: boolean;
  og: boolean;
  ocap: number;
};
export const FRESH = (now: Date): MockState => ({ v: 1, ps: monthPeriod(now).start, um: null, ug: null, plan: null, lots: [], ups: [], n: 0, am: null, ag: null, acap: 0, aspent: 0, om: false, og: false, ocap: 0 });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const nat = (v: unknown, max: number): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max ? v : null);
const packOf = (code: unknown): PackSpec | null => MOCK_PACKS.find((p) => p.code === code) ?? null;
const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isStamp = (v: unknown): v is string => typeof v === "string" && v.length <= 30 && !Number.isNaN(Date.parse(v));
const MAX_ENTRIES = 8;

/** Reads the cookie's JSON with allow-lists; anything that does not fit is dropped (a cookie is never trusted). */
export function parseMock(value: unknown, now: Date): MockState | null {
  if (!isRec(value) || value.v !== 1) return null;
  const fresh = FRESH(now);
  const lots: LotEntry[] = [];
  if (Array.isArray(value.lots)) {
    for (const l of value.lots.slice(0, MAX_ENTRIES)) {
      if (isRec(l) && typeof l.i === "string" && UUID.test(l.i) && packOf(l.c) && isStamp(l.t) && (l.r === "m" || l.r === "a") && nat(l.n, 1e6) !== null) lots.push({ i: l.i, c: l.c as string, t: l.t, r: l.r, n: l.n as number });
    }
  }
  const ups: UpEntry[] = [];
  if (Array.isArray(value.ups)) {
    for (const u of value.ups.slice(0, 3)) {
      if (isRec(u) && typeof u.p === "string" && u.p in TEST_MONTHLY_PAISE && isStamp(u.t) && nat(u.n, 1e6) !== null && nat(u.x, 1e9) !== null) ups.push({ p: u.p, t: u.t, n: u.n as number, x: u.x as number });
    }
  }
  const packFor = (v: unknown, kind: Kind): string | null => (typeof v === "string" && packOf(v)?.kind === kind ? v : null);
  const plan = typeof value.plan === "string" && planDef(value.plan, CATALOGUE) ? value.plan : null;
  return {
    v: 1,
    ps: isDay(value.ps) ? value.ps : fresh.ps,
    um: nat(value.um, 1e7),
    ug: nat(value.ug, 1e7),
    plan,
    lots,
    ups,
    n: nat(value.n, 1e6) ?? 0,
    am: packFor(value.am, "call_minutes"),
    ag: packFor(value.ag, "whatsapp_messages"),
    acap: nat(value.acap, 1e9) ?? 0,
    aspent: nat(value.aspent, 1e9) ?? 0,
    om: value.om === true,
    og: value.og === true,
    ocap: nat(value.ocap, 1e9) ?? 0,
  };
}

/** A new month starts the counts again (the unused top-ups carry over): the mock's version of the period reset. */
export function rolled(s: MockState, now: Date): MockState {
  const p = monthPeriod(now);
  return s.ps === p.start ? s : { ...s, ps: p.start, um: 0, ug: 0, aspent: 0 };
}

// ---- the maths (the MOCK'S own copies of what the API does) ----
/** GST in whole paise: round half up. */
export const gstOf = (taxablePaise: number, rateBp: number): number => Math.floor((taxablePaise * rateBp + 5_000) / 10_000);
/** Same state as the seller: half each (CGST floor, SGST the rest); any other case: all IGST. */
export function splitGst(gst: number, sameState: boolean): { cgst: number; sgst: number; igst: number } {
  if (!sameState) return { cgst: 0, sgst: 0, igst: gst };
  const cgst = Math.floor(gst / 2);
  return { cgst, sgst: gst - cgst, igst: 0 };
}
/** (new monthly price - old monthly price) x days left / days in the period, rounded half up to the paise (never below zero). */
export function proRataPaise(oldMonthly: number, newMonthly: number, daysLeft: number, daysInPeriod: number): number {
  const diff = Math.max(0, newMonthly - oldMonthly);
  if (daysInPeriod <= 0) return 0;
  return Math.floor((diff * daysLeft * 2 + daysInPeriod) / (2 * daysInPeriod));
}

// ---- reading the state as the screens' shapes ----
/** The plan in force in test mode: an upgrade made here, else the plan the Plan part shows (when it has one that can be priced), else the default. */
export function mockPlanId(s: MockState, shown: string | null): string {
  return s.plan ?? (shown && planDef(shown, CATALOGUE) ? shown : DEFAULT_PLAN);
}
function planAllowance(planId: string, kind: Kind, cat: PlanCatalogue): number | null {
  const def = planDef(planId, cat);
  if (!def) return kind === "call_minutes" ? cat.trial.callMinutes : cat.trial.messages;
  return kind === "call_minutes" ? def.callMinutes : def.messages;
}

type Lot = { entry: LotEntry; spec: PackSpec; expires: Date; left: number };
/** The unexpired lots of one kind, oldest first, each with what is still unused: the plan's allowance is used first, then the oldest lot. */
function lotsOf(s: MockState, kind: Kind, used: number, plan: number | null, now: Date): Lot[] {
  const live = s.lots
    .map((entry) => ({ entry, spec: packOf(entry.c)!, expires: new Date(Date.parse(entry.t) + TOPUP_VALID_DAYS * 86_400_000) }))
    .filter((l) => l.spec.kind === kind && l.expires.getTime() > now.getTime())
    .sort((a, b) => Date.parse(a.entry.t) - Date.parse(b.entry.t));
  let excess = Math.max(0, used - (plan ?? 0));
  return live.map((l) => {
    const drawn = Math.min(l.spec.units, excess);
    excess -= drawn;
    return { ...l, left: l.spec.units - drawn };
  });
}

function meterOf(s: MockState, kind: Kind, planId: string, cat: PlanCatalogue, now: Date): Meter {
  const period = monthPeriod(now);
  const plan = planAllowance(planId, kind, cat);
  const stored = kind === "call_minutes" ? s.um : s.ug;
  const used = stored ?? (plan === null ? (kind === "call_minutes" ? 120 : 140) : Math.round(plan * (kind === "call_minutes" ? 0.805 : 0.4) * 10) / 10);
  const lots = lotsOf(s, kind, used, plan, now);
  const lotUnits = lots.reduce((sum, l) => sum + l.spec.units, 0);
  const balance = lots.reduce((sum, l) => sum + l.left, 0);
  const included = plan === null || plan > 0 || lotUnits > 0;
  const allowance = plan === null ? null : plan + lotUnits;
  const percent = allowance === null || allowance <= 0 ? null : Math.max(0, Math.min(100, Math.floor((used / allowance) * 100)));
  const enabled = kind === "call_minutes" ? s.om : s.og;
  const rate = OVERAGE_RATE[kind];
  const over = allowance === null ? 0 : Math.max(0, used - allowance);
  const spent = Math.min(s.ocap, Math.ceil(over * rate));
  const overageOn = enabled && s.ocap > 0;
  const capReached = overageOn && spent >= s.ocap;
  let state: Meter["state"] = !included ? "stopped" : percent === null ? "ok" : percent >= 100 ? "stopped" : percent >= 80 ? "notice" : "ok";
  if (state === "stopped" && included && overageOn && !capReached) state = "notice";
  const blocked = state === "stopped";
  const projected = projectRunOut({ used, allowance, periodStart: period.start, periodEnd: period.end, now });
  return {
    kind,
    used,
    allowance,
    remaining: allowance === null ? null : Math.max(0, Math.round((allowance - used) * 10) / 10),
    percent,
    state,
    included,
    planAllowance: plan,
    topupBalance: balance,
    nextTopupExpiry: lots.find((l) => l.left > 0) ? istDay(lots.find((l) => l.left > 0)!.expires) : null,
    projectedRunOutOn: projected,
    runsOutBeforePeriodEnd: projected !== null,
    blocked,
    overage: overageOn || over > 0 ? { enabled: overageOn, units: over, spentPaise: spent, capPaise: s.ocap, ratePaisePerUnit: rate } : null,
    queued: blocked ? (kind === "call_minutes" ? MOCK_QUEUED_CALLS : MOCK_QUEUED_MESSAGES) : 0,
  };
}

export function mockUsage(s0: MockState, shownPlan: string | null, now: Date, cat: PlanCatalogue = CATALOGUE): UsageView {
  const s = rolled(s0, now);
  const planId = mockPlanId(s, shownPlan);
  const p = monthPeriod(now);
  const minutes = meterOf(s, "call_minutes", planId, cat, now);
  const messages = meterOf(s, "whatsapp_messages", planId, cat, now);
  return { period: { start: p.start, end: p.end, daysLeft: p.daysLeft }, minutes, messages, queuedCalls: minutes.queued };
}

export function mockPacks(): Pack[] {
  return MOCK_PACKS.map((p) => {
    const gst = gstOf(p.pricePaise, GST_BP);
    return { code: p.code, kind: p.kind, units: p.units, pricePaise: p.pricePaise, gstRateBp: GST_BP, gstPaise: gst, totalPaise: p.pricePaise + gst, isPlaceholder: true };
  });
}

const SELLER = { name: "Test seller (placeholder)", state: "36" };
function invoiceOf(n: number, at: string, kind: Invoice["kind"], description: string, taxable: number): Invoice {
  const gst = gstOf(taxable, GST_BP);
  const split = splitGst(gst, false); // the test workspace has no GSTIN set: all IGST
  const ym = istDay(new Date(at)).slice(2, 7).replace("-", "");
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    number: `S19-${ym}-${String(n).padStart(6, "0")}`,
    kind,
    description,
    issuedAt: at,
    taxablePaise: taxable,
    gstRateBp: GST_BP,
    cgstPaise: split.cgst,
    sgstPaise: split.sgst,
    igstPaise: split.igst,
    totalPaise: taxable + gst,
    sellerName: SELLER.name,
    sellerStateCode: SELLER.state,
    sellerGstin: null,
    buyerGstin: null,
    buyerStateCode: null,
    fake: true,
    paymentStatus: "paid_fake",
  };
}

export function mockTopups(s0: MockState, shownPlan: string | null, now: Date, cat: PlanCatalogue = CATALOGUE): TopupsView {
  const s = rolled(s0, now);
  const usage = mockUsage(s, shownPlan, now, cat);
  const packs = mockPacks();
  const balance: Balance = { call_minutes: { units: 0, lots: [] }, whatsapp_messages: { units: 0, lots: [] } };
  const history: Purchase[] = [];
  const invoices: Invoice[] = [];
  for (const kind of ["call_minutes", "whatsapp_messages"] as const) {
    const m = kind === "call_minutes" ? usage.minutes : usage.messages;
    const plan = m.planAllowance;
    for (const l of lotsOf(s, kind, m.used, plan, now)) {
      if (l.left <= 0) continue;
      balance[kind].units += l.left;
      balance[kind].lots.push({ purchaseId: l.entry.i, unitsLeft: l.left, purchasedAt: l.entry.t, expiresAt: l.expires.toISOString() });
    }
  }
  for (const e of s.lots) {
    const spec = packOf(e.c)!;
    const pack = packs.find((p) => p.code === e.c)!;
    const left = balance[spec.kind].lots.find((l) => l.purchaseId === e.i)?.unitsLeft ?? 0;
    history.push({ id: e.i, packCode: e.c, kind: spec.kind, units: spec.units, source: e.r === "a" ? "auto" : "manual", pricePaise: pack.pricePaise, totalPaise: pack.totalPaise, purchasedAt: e.t, expiresAt: new Date(Date.parse(e.t) + TOPUP_VALID_DAYS * 86_400_000).toISOString(), unitsLeft: left, invoiceId: invoiceOf(e.n, e.t, "topup", "", pack.pricePaise).id });
    invoices.push(invoiceOf(e.n, e.t, "topup", `Top-up: ${spec.units} ${spec.kind === "call_minutes" ? "minutes" : "messages"}`, pack.pricePaise));
  }
  for (const u of s.ups) invoices.push(invoiceOf(u.n, u.t, "upgrade", `Upgrade to ${planDef(u.p, cat)?.name ?? u.p}, rest of the month`, u.x));
  history.sort((a, b) => Date.parse(b.purchasedAt) - Date.parse(a.purchasedAt));
  invoices.sort((a, b) => Date.parse(b.issuedAt) - Date.parse(a.issuedAt) || b.number.localeCompare(a.number));
  const settings: TopupSettings = {
    autoMinutesPack: s.am,
    autoMessagesPack: s.ag,
    autoMonthlyCapPaise: s.acap,
    overageMinutes: s.om,
    overageMessages: s.og,
    overageMonthlyCapPaise: s.ocap,
    overageRatePaisePerMinute: OVERAGE_RATE.call_minutes,
    overageRatePaisePerMessage: OVERAGE_RATE.whatsapp_messages,
    autoSpentPaise: s.aspent,
    overageSpentPaise: Math.min(s.ocap, Math.ceil(usage.minutes.overage?.units ?? 0) * OVERAGE_RATE.call_minutes + Math.ceil(usage.messages.overage?.units ?? 0) * OVERAGE_RATE.whatsapp_messages),
  };
  return { mode: "mock", planId: mockPlanId(s, shownPlan), usage, packs, balance, settings, history, invoices };
}

// ---- the moves: each returns the new state or a refusal, never throws ----
type Out = { next: MockState } | { error: TopupError };

/** Buys a pack (fake payment). The same purchase id with the same pack changes nothing and is fine; with another pack it is a conflict. */
export function buyPack(s0: MockState, purchaseId: string, code: string, now: Date, source: "m" | "a" = "m"): Out {
  const s = rolled(s0, now);
  if (!UUID.test(purchaseId)) return { error: "invalid" };
  if (!packOf(code)) return { error: "pack_unknown" };
  const same = s.lots.find((l) => l.i === purchaseId);
  if (same) return same.c === code ? { next: s } : { error: "conflict" };
  const lots = [...s.lots, { i: purchaseId, c: code, t: now.toISOString().slice(0, 19) + "Z", r: source, n: s.n + 1 }];
  // the cookie is small on purpose: only the newest purchases are kept (the older ones fall off the list; the units they hold are gone with them in test mode)
  return { next: { ...s, lots: lots.slice(-MAX_ENTRIES), n: s.n + 1 } };
}

export function setSettings(s0: MockState, input: SettingsInput, now: Date): Out {
  const s = rolled(s0, now);
  const am = input.autoMinutesPack === null ? null : packOf(input.autoMinutesPack);
  const ag = input.autoMessagesPack === null ? null : packOf(input.autoMessagesPack);
  if ((input.autoMinutesPack !== null && !am) || (input.autoMessagesPack !== null && !ag)) return { error: "pack_unknown" };
  if ((am && am.kind !== "call_minutes") || (ag && ag.kind !== "whatsapp_messages")) return { error: "invalid" };
  const caps = [input.autoMonthlyCapPaise, input.overageMonthlyCapPaise];
  if (caps.some((c) => !Number.isSafeInteger(c) || c < 0 || c > 100_000_000)) return { error: "invalid" };
  if ((input.overageMinutes || input.overageMessages) && input.overageMonthlyCapPaise <= 0) return { error: "cap_required" };
  if ((input.autoMinutesPack || input.autoMessagesPack) && input.autoMonthlyCapPaise <= 0) return { error: "cap_required" };
  return { next: { ...s, am: input.autoMinutesPack, ag: input.autoMessagesPack, acap: input.autoMonthlyCapPaise, om: input.overageMinutes, og: input.overageMessages, ocap: input.overageMonthlyCapPaise } };
}

/** The plans a mid-month upgrade can go to: those after the current one on the list (the list is in the order of `sort`). */
export function upgradeTargets(currentId: string | null, cat: PlanCatalogue = CATALOGUE): PlanDef[] {
  const at = cat.plans.findIndex((p) => p.id === currentId);
  return cat.plans.slice(at + 1).filter((p) => p.kind === "main" || p.kind === "calls");
}

export function previewUpgrade(s0: MockState, shownPlan: string | null, toPlanId: string, now: Date, cat: PlanCatalogue = CATALOGUE): UpgradePreview | { error: TopupError } {
  const s = rolled(s0, now);
  const from = mockPlanId(s, shownPlan);
  const to = upgradeTargets(from, cat).find((p) => p.id === toPlanId);
  if (!to) return { error: "not_an_upgrade" };
  const p = monthPeriod(now);
  const oldM = TEST_MONTHLY_PAISE[from];
  const newM = TEST_MONTHLY_PAISE[to.id];
  const priceSet = oldM !== undefined && newM !== undefined;
  const prorated = priceSet ? proRataPaise(oldM, newM, p.daysLeft, p.days) : null;
  const gst = prorated === null ? null : gstOf(prorated, GST_BP);
  return {
    fromPlanId: from,
    toPlanId: to.id,
    priceSet,
    daysInPeriod: p.days,
    daysLeft: p.daysLeft,
    proratedPaise: prorated,
    gstPaise: gst,
    totalPaise: prorated === null || gst === null ? null : prorated + gst,
    newAllowances: { callMinutes: to.callMinutes, messages: to.messages },
    effective: "now",
  };
}

export function upgrade(s0: MockState, shownPlan: string | null, toPlanId: string, now: Date, cat: PlanCatalogue = CATALOGUE): Out {
  const s = rolled(s0, now);
  const pv = previewUpgrade(s, shownPlan, toPlanId, now, cat);
  if ("error" in pv) return { error: pv.error };
  const ups = pv.proratedPaise !== null && pv.proratedPaise > 0 ? [...s.ups, { p: toPlanId, t: now.toISOString().slice(0, 19) + "Z", n: s.n + 1, x: pv.proratedPaise }].slice(-3) : s.ups;
  // the new allowance starts at once and the period does not move: only the plan changes
  return { next: { ...s, plan: toPlanId, ups, n: ups === s.ups ? s.n : s.n + 1 } };
}

/** Test only: sets what has been used (a percentage of each allowance) so the notices at 80 and 100 percent can be looked at; a percentage of 0 starts a new month. Then the auto top-up runs, like the API's would at 100 percent. */
export function simulate(s0: MockState, shownPlan: string | null, percent: number, now: Date, cat: PlanCatalogue = CATALOGUE): Out {
  if (![0, 50, 80, 100].includes(percent)) return { error: "invalid" };
  let s = rolled(s0, now);
  const planId = mockPlanId(s, shownPlan);
  const at = (kind: Kind): number => {
    const plan = planAllowance(planId, kind, cat);
    const lotUnits = s.lots.filter((l) => packOf(l.c)!.kind === kind).reduce((sum, l) => sum + packOf(l.c)!.units, 0);
    const total = plan === null ? 300 : plan + lotUnits;
    return Math.round(total * (percent / 100) * 10) / 10;
  };
  s = { ...s, um: at("call_minutes"), ug: at("whatsapp_messages"), aspent: percent === 0 ? 0 : s.aspent };
  if (percent === 100) {
    const view = mockUsage(s, shownPlan, now, cat);
    for (const [kind, code] of [["call_minutes", s.am], ["whatsapp_messages", s.ag]] as const) {
      const m = kind === "call_minutes" ? view.minutes : view.messages;
      const spec = packOf(code);
      if (!spec || m.state !== "stopped") continue;
      const pack = mockPacks().find((p) => p.code === spec.code)!;
      if (s.aspent + pack.totalPaise > s.acap) continue; // the monthly limit would be passed: nothing is bought
      const bought = buyPack(s, `00000000-0000-4000-8000-${String(900_000 + s.n).padStart(12, "0")}`, spec.code, now, "a");
      if ("next" in bought) s = { ...bought.next, aspent: s.aspent + pack.totalPaise };
    }
  }
  return { next: s };
}
