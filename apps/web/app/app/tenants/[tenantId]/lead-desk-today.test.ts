import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appT } from "@/i18n/app";
import { ApiAuthError } from "@/lib/api/client";
import type { BatchAnswer, BatchItem, Handoff, Rule } from "@/lib/outreach/types";
import type { TaskOut } from "@/lib/tasks/types";
import { NOTHING_TODAY, type NeedsCard, type TodayData } from "@/components/v2/app/today/types";

const readBatches = vi.fn();
const readHandoffs = vi.fn();
const readItems = vi.fn();
const readRules = vi.fn();
const readTasks = vi.fn();
const readDeskLeads = vi.fn();
vi.mock("@/lib/outreach/source", () => ({ readBatches: (...a: unknown[]) => readBatches(...a), readHandoffs: (...a: unknown[]) => readHandoffs(...a), readItems: (...a: unknown[]) => readItems(...a), readRules: (...a: unknown[]) => readRules(...a) }));
vi.mock("@/lib/tasks/source", () => ({ readTasks: (...a: unknown[]) => readTasks(...a) }));
vi.mock("@/lib/lead-desk/leads-source", () => ({ readDeskLeads: (...a: unknown[]) => readDeskLeads(...a) }));

import { mergeDesk } from "./today-data";
import { needsOf, readLeadDesk, teamOf } from "./lead-desk-today";

const en = appT("en");
const t = (key: string, vars?: Record<string, string | number>) => en(key as "frame.notyet", vars);
const sourceName = (tag: string) => (tag === "indiamart" ? "IndiaMART" : tag);
const BASE = "/app/tenants/T";
const CTX = { token: "tok", tenantId: "T", userId: "U" };
const NOW = Date.parse("2026-10-27T10:00:00Z");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const batch = (n: number, over: Partial<BatchAnswer["batch"]> = {}, ready = 12, progress: BatchAnswer["progress"] = null): BatchAnswer => ({
  batch: { id: id(n), name: `Plan ${n}`, status: "planned", pausedReason: null, goal: "site_visit", channel: "call", language: "te", questions: [], messageText: null, windowDays: 3, maxCallsPerDay: null, maxTotalMinutes: null, planSha256: "x", createdAt: "2026-10-27T06:00:00Z", approvedAt: null, finishedAt: null, ...over },
  plan: { count: ready, ready, skipped: {}, sample: [], windowFrom: null, windowTo: null, estimatedMinutes: 0, estimatedMessages: 0, estimatedCostPaise: 0, maxCallsPerDay: null, maxTotalMinutes: null },
  progress,
});
const handoff = (n: number, over: Partial<Handoff> = {}): Handoff => ({ id: id(n), leadId: id(n + 100), contactId: id(n + 200), contactName: `Ravi ${n}`, summary: "x", assignedTo: id(1), notifiedAt: "2026-10-27T08:00:00Z", reminderSentAt: null, actedAt: null, ...over });
const rule = (n: number, over: Partial<Rule> = {}): Rule => ({ id: id(n), source: "indiamart", action: "call_within_minutes", withinMinutes: 1, goal: "site_visit", channel: "call", language: "te", questions: [], messageText: null, maxCallsPerDay: null, maxTotalMinutes: null, active: true, pausedReason: null, approvedAt: "2026-10-26T06:00:00Z", usage: { leads: 0, callsToday: 0, minutesUsed: 0 }, ...over });
const task = (n: number, over: Partial<TaskOut> = {}) => ({ id: id(n), status: "planned", instruction: `Call the people from ${n}`, created_at: "2026-10-27T07:00:00Z", approved_at: null, finished_at: null, pause_reason: null, ...over }) as unknown as TaskOut;
const item = (n: number, over: Partial<BatchItem> = {}): BatchItem => ({ id: id(n), contactId: id(n), leadId: null, name: "x", status: "waiting", reason: null, attempts: 1, nextAction: "call", nextAt: "2026-10-27T09:00:00Z", lastResult: "connected", ...over });
const none = { batches: null, handoffs: null, rules: null, tasks: null, callbacks: new Map() };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("OUTREACH_SCREENS", "1");
  vi.stubEnv("TASK_SCREENS", "1");
  vi.stubEnv("LEADS_SCREENS", "1");
  readBatches.mockResolvedValue(null);
  readHandoffs.mockResolvedValue(null);
  readItems.mockResolvedValue({ items: [], nextCursor: null });
  readRules.mockResolvedValue(null);
  readTasks.mockResolvedValue({ ok: true, value: [] });
  readDeskLeads.mockResolvedValue(null);
});
afterEach(() => vi.unstubAllEnvs());

describe("Lead Desk on Today: what needs the person", () => {
  const parts = {
    batches: [batch(1), batch(2, { status: "paused", pausedReason: "cap_minutes", approvedAt: "2026-10-27T05:00:00Z" }), batch(3, { status: "paused", pausedReason: "owner" }), batch(4, { status: "running" })],
    handoffs: [handoff(1), handoff(2, { actedAt: "2026-10-27T09:00:00Z" })],
    rules: [rule(11), rule(12, { active: false, pausedReason: "cap_calls" }), rule(13, { active: false, pausedReason: "owner" })],
    tasks: [task(21), task(22, { status: "paused", pause_reason: "cap", approved_at: "2026-10-27T05:30:00Z" }), task(23, { status: "paused", pause_reason: "owner" }), task(24, { status: "needs_answer" })],
    callbacks: new Map([[id(4), { name: "Plan 4", n: 3, at: "2026-10-27T09:00:00Z" }]]),
  };
  const kinds = (cards: NeedsCard[]) => cards.map((c) => (c.type === "item" ? c.item.kind : c.type));

  it("the Owner is shown a hot lead, the plans and tasks waiting for the one approval, the limits reached and the callbacks due", () => {
    const cards = needsOf(parts, "owner", BASE, t);
    expect(kinds(cards).sort()).toEqual(["callback_due", "hot_lead_waiting", "outreach_paused", "outreach_paused", "outreach_paused", "plan_waiting", "plan_waiting"]);
    const by = (kind: string) => cards.flatMap((c) => (c.type === "item" && c.item.kind === kind ? [c.item] : []));
    expect(by("hot_lead_waiting")).toMatchObject([{ id: id(1), customer: "Ravi 1", href: `${BASE}/leads/${id(101)}`, summary: "Showed interest and nobody has called back yet." }]);
    expect(by("plan_waiting").map((i) => i.href).sort()).toEqual([`${BASE}/outreach/batches/${id(1)}`, `${BASE}/tasks/${id(21)}`].sort());
    expect(by("plan_waiting").find((i) => i.href.includes("batches"))?.summary).toBe("A plan for 12 people is ready. Approve it once and the calls and messages start.");
    expect(by("callback_due")).toMatchObject([{ customer: "Plan 4", href: `${BASE}/outreach/batches/${id(4)}`, summary: "3 people asked for a call back and their time has come." }]);
    expect(by("outreach_paused").map((i) => i.summary).sort()).toEqual(["Calling is paused: you reached the day's limit.", "Calling is paused: you reached the minutes you allowed.", "This task is paused: it reached the spending limit you set."].sort());
    expect(by("outreach_paused").find((i) => i.customer === "IndiaMART")?.href).toBe(`${BASE}/outreach`);
  });
  it("a card has the same key as the API's own item of its kind, so one thing is one card", () => {
    const keys = needsOf(parts, "owner", BASE, t).map((c) => c.key);
    expect(keys).toContain(`hot_lead_waiting-${id(1)}`);
    expect(keys).toContain(`outreach_paused-${id(2)}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("an Admin sees the limits and callbacks but not the plans only the Owner approves; Sales see the hot leads only; a Viewer nothing", () => {
    expect(kinds(needsOf(parts, "admin", BASE, t)).sort()).toEqual(["callback_due", "hot_lead_waiting", "outreach_paused", "outreach_paused", "outreach_paused"]);
    expect(kinds(needsOf(parts, "sales", BASE, t))).toEqual(["hot_lead_waiting"]);
  });
  it("a hand-off with no lead opens the hot leads of the Lead Desk; an acted hand-off, a plan paused by its owner and a task that needs an answer are not listed", () => {
    const cards = needsOf({ ...none, handoffs: [handoff(1, { leadId: null }), handoff(2, { actedAt: "2026-10-27T09:00:00Z" })], batches: [batch(3, { status: "paused", pausedReason: "owner" })], tasks: [task(4, { status: "needs_answer" })] }, "owner", BASE, t);
    expect(cards).toHaveLength(1);
    expect(cards[0].type === "item" && cards[0].item.href).toBe(`${BASE}/lead-desk?hot=1`);
  });
  it("is newest first and empty when nothing waits", () => {
    const cards = needsOf(parts, "owner", BASE, t);
    expect(cards.map((c) => Date.parse(c.at))).toEqual([...cards.map((c) => Date.parse(c.at))].sort((a, b) => b - a));
    expect(needsOf(none, "owner", BASE, t)).toEqual([]);
  });
});

describe("Lead Desk on Today: the workers with their real status", () => {
  it("each worker tells what it does now or did last, from its own part", () => {
    const team = teamOf(
      { batches: [batch(1, { status: "running", approvedAt: "2026-10-27T06:00:00Z" }, 40, { total: 40, waiting: 28, done: 12, callsMade: 12, connected: 5, interested: 2, minutesUsed: 20 })], handoffs: null, rules: [rule(1), rule(2, { active: false })], tasks: [task(1, { status: "running", approved_at: "2026-10-27T08:00:00Z" })], callbacks: new Map(), lead: { name: "Anita R.", source: "indiamart", at: "2026-10-27T09:50:00Z" } },
      t,
      sourceName,
    );
    expect(team.map((w) => [w.key, w.state, w.text])).toEqual([
      ["leads", "idle", "Last lead: Anita R. from IndiaMART"],
      ["calls", "working", "Calling Plan 1: 12 of 40 done"],
      ["rules", "idle", "1 rule is on, calling new leads by itself"],
      ["tasks", "working", "Working on: Call the people from 1"],
    ]);
    expect(team[0].at).toBe("2026-10-27T09:50:00Z");
  });
  it("says so when there is nothing yet, and a part that is off or unread is not drawn at all", () => {
    const team = teamOf({ ...none, batches: [], rules: [], tasks: [], lead: null }, t, sourceName);
    expect(team.map((w) => [w.key, w.state, w.text])).toEqual([["leads", "idle", "No leads yet"], ["calls", "idle", "No calling plan yet"], ["rules", "off", "No rule is on"], ["tasks", "idle", "No task yet"]]);
    expect(teamOf(none, t, sourceName)).toEqual([]);
  });
});

describe("readLeadDesk", () => {
  it("asks only for the parts whose flag is on, and a Viewer is asked nothing", async () => {
    vi.stubEnv("OUTREACH_SCREENS", "");
    vi.stubEnv("TASK_SCREENS", "");
    vi.stubEnv("LEADS_SCREENS", "");
    expect(await readLeadDesk(CTX, "owner", BASE, t, sourceName, NOW)).toEqual({ needs: [], team: [] });
    expect([readBatches, readHandoffs, readRules, readTasks, readDeskLeads].map((f) => f.mock.calls.length)).toEqual([0, 0, 0, 0, 0]);
    vi.stubEnv("OUTREACH_SCREENS", "1");
    expect(await readLeadDesk(CTX, "viewer", BASE, t, sourceName, NOW)).toEqual({ needs: [], team: [] });
    expect(readBatches).not.toHaveBeenCalled();
  });
  it("counts the callbacks that are due from the items of a running plan: answered, waiting for a call, time come; one card per plan", async () => {
    readBatches.mockResolvedValue([batch(1, { status: "running", approvedAt: "2026-10-27T06:00:00Z" }), batch(2, { status: "planned" })]);
    readItems.mockResolvedValue({
      items: [item(1), item(2, { nextAt: "2026-10-27T08:30:00Z" }), item(3, { nextAt: "2026-10-27T11:00:00Z" }), item(4, { lastResult: "no_answer" }), item(5, { status: "done" }), item(6, { attempts: 0 })],
      nextCursor: null,
    });
    const { needs } = await readLeadDesk(CTX, "owner", BASE, t, sourceName, NOW);
    const callbacks = needs.flatMap((c) => (c.type === "item" && c.item.kind === "callback_due" ? [c] : []));
    expect(callbacks).toHaveLength(1);
    expect(callbacks[0].item).toMatchObject({ id: id(1), customer: "Plan 1", summary: "2 people asked for a call back and their time has come." });
    expect(callbacks[0].at).toBe("2026-10-27T08:30:00Z");
    expect(readItems).toHaveBeenCalledTimes(1); // only the running plan is asked
  });
  it("a part that fails adds nothing; the rest still shows", async () => {
    readBatches.mockRejectedValue(new Error("down"));
    readHandoffs.mockResolvedValue([handoff(1)]);
    readTasks.mockResolvedValue({ ok: false, error: "down" });
    const { needs, team } = await readLeadDesk(CTX, "owner", BASE, t, sourceName, NOW);
    expect(needs.map((c) => c.key)).toEqual([`hot_lead_waiting-${id(1)}`]);
    expect(team).toEqual([]);
  });
  it("a rejected session is passed on, so the person is sent to sign in", async () => {
    readHandoffs.mockRejectedValue(new ApiAuthError());
    await expect(readLeadDesk(CTX, "owner", BASE, t, sourceName, NOW)).rejects.toBeInstanceOf(ApiAuthError);
  });
  it("Sales ask for the hand-offs and the plans only: no rules, tasks or leads", async () => {
    await readLeadDesk(CTX, "sales", BASE, t, sourceName, NOW);
    expect(readHandoffs).toHaveBeenCalled();
    expect([readRules, readTasks, readDeskLeads].map((f) => f.mock.calls.length)).toEqual([0, 0, 0]);
  });
});

describe("Lead Desk's items join Today's own, and the count is the truth", () => {
  const api = (key: string, at: string): NeedsCard => ({ type: "item", key, at, item: { kind: "hot_lead_waiting", id: key.split("-").slice(1).join("-"), customer: "Ravi 1", city: null, agent: "followup_desk", summary: "api words", at, amount_paise: null, href: "x" } });
  const base = (over: Partial<TodayData> = {}): TodayData => ({ ...NOTHING_TODAY, cards: { waiting: 1, money_held_paise: 0, orders_open: 0 }, needs: [api(`hot_lead_waiting-${id(1)}`, "2026-10-27T08:05:00Z")], ...over });

  it("one thing the API listed too is one card (Lead Desk's words, the API's time); one only Lead Desk knows is added and counted", () => {
    const desk = needsOf({ ...none, handoffs: [handoff(1), handoff(2, { notifiedAt: "2026-10-27T09:00:00Z" })] }, "owner", BASE, t);
    const merged = mergeDesk(base(), { needs: desk, team: [] });
    expect(merged.needs?.map((c) => c.key)).toEqual([`hot_lead_waiting-${id(2)}`, `hot_lead_waiting-${id(1)}`]);
    expect(merged.cards.waiting).toBe(2);
    const first = merged.needs?.find((c) => c.key === `hot_lead_waiting-${id(1)}`);
    expect(first?.type === "item" && [first.item.summary, first.at]).toEqual(["Showed interest and nobody has called back yet.", "2026-10-27T08:05:00Z"]);
  });
  it("does not change a Today that Lead Desk adds nothing to, and a Today that could not be read stays unread", () => {
    const today = base();
    expect(mergeDesk(today, { needs: [], team: [] })).toMatchObject({ needs: today.needs, cards: today.cards, deskTeam: null });
    expect(mergeDesk({ ...today, needs: null }, { needs: needsOf({ ...none, handoffs: [handoff(3)] }, "owner", BASE, t), team: [] }).needs).toBeNull();
  });
  it("carries the workers for 'Your team' only when there are some", () => {
    const team = [{ key: "calls" as const, state: "idle" as const, name: "Caller", text: "No calling plan yet", at: null }];
    expect(mergeDesk(base(), { needs: [], team }).deskTeam).toEqual(team);
    expect(mergeDesk(base(), { needs: [], team: [] }).deskTeam).toBeNull();
  });
});
