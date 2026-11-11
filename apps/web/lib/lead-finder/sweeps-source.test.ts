import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "@/lib/api/client";

const jar = vi.hoisted(() => ({ v: new Map<string, string>() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (k: string) => (jar.v.has(k) ? { value: jar.v.get(k) } : undefined), set: (k: string, v: string) => void jar.v.set(k, v) }) }));
const api = vi.hoisted(() => ({ preview: vi.fn(), list: vi.fn(), create: vi.fn(), change: vi.fn(), run: vi.fn(), remove: vi.fn(), runs: vi.fn() }));
vi.mock("@/lib/api/lead-finder-sweeps", () => ({ previewSweep: api.preview, listSweeps: api.list, createSweep: api.create, changeSweep: api.change, runSweepNow: api.run, removeSweep: api.remove, listSweepRuns: api.runs }));

import { addSweep, dropSweep, editSweep, MOCK_COOKIE, previewNew, readSweeps, runNow } from "./sweeps-source";

const CTX = { token: "tok", tenantId: "11111111-1111-4111-8111-111111111111" };
const NOW = Date.UTC(2026, 10, 11, 4, 0, 0);
const IN = { text: "find new retailers in Jayanagar", language: "en", weekday: 2, hour: 8, maxResults: 10 };

beforeEach(() => {
  jar.v.clear();
  vi.stubEnv("SWEEP_SCREENS", "mock");
  for (const f of Object.values(api)) f.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("the weekly search, test mode (SWEEP_SCREENS=mock): made up, in a cookie, no API", () => {
  it("starts with two made-up searches, one running with its last run and one paused; nothing is asked of the API", async () => {
    const r = await readSweeps(CTX, NOW);
    expect(r).toMatchObject({ mode: "ok", demo: true, maxSweeps: 5, weeklyBudgetPaise: 0 });
    if (r.mode !== "ok") throw new Error("x");
    expect(r.items.map((s) => [s.query, s.enabled])).toEqual([["saree shops", true], ["boutiques", false]]);
    expect(r.items[0].lastRun).toMatchObject({ state: "done", newSinceLastRun: 6, trigger: "schedule" });
    expect(r.items[0].nextRunAt).not.toBeNull();
    expect(r.items[1].nextRunAt).toBeNull(); // paused
    expect(r.items.every((s) => s.provider === "fixture" && s.estCostPaise === 0)).toBe(true);
    expect(Object.values(api).every((f) => f.mock.calls.length === 0)).toBe(true);
  });
  it("add splits the owner's words into what and where, keeps it in the cookie, and stops at five", async () => {
    const s = await addSweep(CTX, IN, NOW);
    expect(s).toMatchObject({ query: "retailers", area: "Jayanagar", weekday: 2, hour: 8, maxResults: 10, enabled: true, lastRun: null });
    expect(jar.v.get(MOCK_COOKIE)?.length).toBeLessThan(3500);
    const r = await readSweeps(CTX, NOW);
    expect(r.mode === "ok" && r.items).toHaveLength(3);
    for (let i = 0; i < 2; i++) await addSweep(CTX, { ...IN, text: `find shops number ${i} in Eluru` }, NOW);
    await expect(addSweep(CTX, IN, NOW)).rejects.toMatchObject({ status: 409, code: "sweep_limit_reached" });
    await expect(addSweep(CTX, { ...IN, hour: 30 }, NOW)).rejects.toMatchObject({ status: 422 });
  });
  it("the card before the OK stores nothing: what the words mean, the first run, no cost, how many of the five; it refuses what create refuses", async () => {
    const p = await previewNew(CTX, IN, NOW);
    expect(p).toMatchObject({ query: "retailers", area: "Jayanagar", weekday: 2, hour: 8, maxResults: 10, provider: "fixture", estCostPaise: 0, fitsBudget: true, sweepsUsed: 2, maxSweeps: 5 });
    expect(p.nextRunAt).not.toBeNull();
    expect(jar.v.has(MOCK_COOKIE)).toBe(false); // nothing was saved
    await expect(previewNew(CTX, { ...IN, hour: 40 }, NOW)).rejects.toMatchObject({ status: 422 });
    for (let i = 0; i < 3; i++) await addSweep(CTX, { ...IN, text: `find shops number ${i} in Eluru` }, NOW);
    await expect(previewNew(CTX, IN, NOW)).rejects.toMatchObject({ status: 409, code: "sweep_limit_reached" });
  });
  it("pause, resume, change the day: next run follows; run now adds a run the owner started; remove takes it away (twice is fine); an unknown one is 404", async () => {
    const first = (await readSweeps(CTX, NOW)) as Extract<Awaited<ReturnType<typeof readSweeps>>, { mode: "ok" }>;
    const id = first.items[0].id;
    expect((await editSweep(CTX, id, { enabled: false }, NOW)).nextRunAt).toBeNull();
    expect((await editSweep(CTX, id, { enabled: true, weekday: 5, hour: 18 }, NOW))).toMatchObject({ enabled: true, weekday: 5, hour: 18 });
    const run = await runNow(CTX, id, NOW);
    expect(run).toMatchObject({ state: "done", trigger: "owner" });
    expect(run.newSinceLastRun).toBeGreaterThan(0);
    const after = (await readSweeps(CTX, NOW + 60_000)) as typeof first;
    expect(after.items[0].lastRun?.trigger).toBe("owner");
    await dropSweep(CTX, id, NOW);
    await dropSweep(CTX, id, NOW);
    expect(((await readSweeps(CTX, NOW)) as typeof first).items.map((s) => s.id)).not.toContain(id);
    await expect(editSweep(CTX, id, { enabled: false }, NOW)).rejects.toBeInstanceOf(ApiRequestError);
    await expect(runNow(CTX, "5e1e0000-0000-4000-8000-0000000000ff", NOW)).rejects.toMatchObject({ status: 404 });
  });
  it("a cookie that is not ours is ignored (the made-up start is used)", async () => {
    jar.v.set(MOCK_COOKIE, "{not json");
    expect((await readSweeps(CTX, NOW)).mode).toBe("ok");
    jar.v.set(MOCK_COOKIE, JSON.stringify({ v: 2, s: [] }));
    const r = await readSweeps(CTX, NOW);
    expect(r.mode === "ok" && r.items).toHaveLength(2);
  });
});

describe("the other modes", () => {
  it("off: the part is not there and nothing can be changed", async () => {
    vi.stubEnv("SWEEP_SCREENS", "");
    expect(await readSweeps(CTX, NOW)).toEqual({ mode: "off" });
    await expect(addSweep(CTX, IN, NOW)).rejects.toMatchObject({ status: 404 });
    await expect(runNow(CTX, "5e1e0000-0000-4000-8000-000000000001", NOW)).rejects.toMatchObject({ status: 404 });
  });
  it("on: C1's API (written against the proposal), each run list read once per sweep; a failure is 'unavailable', never made-up data", async () => {
    vi.stubEnv("SWEEP_SCREENS", "1");
    const sweep = { id: "5e1e0000-0000-4000-8000-000000000001" };
    api.list.mockResolvedValueOnce({ items: [sweep], maxSweeps: 5, weeklyBudgetPaise: 0 });
    api.runs.mockResolvedValueOnce([]);
    expect(await readSweeps(CTX, NOW)).toMatchObject({ mode: "ok", demo: false, items: [sweep] });
    expect(api.runs).toHaveBeenCalledWith("tok", CTX.tenantId, sweep.id, 4);
    api.list.mockRejectedValueOnce(new Error("down"));
    expect(await readSweeps(CTX, NOW)).toEqual({ mode: "unavailable" });
    api.preview.mockResolvedValueOnce({ query: "q" });
    expect(await previewNew(CTX, IN, NOW)).toEqual({ query: "q" });
    expect(api.preview).toHaveBeenCalledWith("tok", CTX.tenantId, IN);
    api.create.mockResolvedValueOnce({ id: "x" });
    await addSweep(CTX, IN, NOW);
    expect(api.create).toHaveBeenCalledWith("tok", CTX.tenantId, IN);
  });
});
