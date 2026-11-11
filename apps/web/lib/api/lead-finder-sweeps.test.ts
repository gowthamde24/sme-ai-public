import { afterEach, describe, expect, it, vi } from "vitest";

import { changeSweep, createSweep, listSweepRuns, listSweeps, removeSweep, runSweepNow } from "./lead-finder-sweeps";

const T = "11111111-1111-4111-8111-111111111111";
const S = "5e1e0000-0000-4000-8000-000000000001";
const SWEEP = { id: S, query: "saree shops", area: "Jayanagar Bengaluru", max_results: 20, weekday: 1, hour: 7, enabled: true, provider: "fixture", est_cost_paise: 0, cost_is_estimate: false, attribution: null, next_run_at: "2026-11-16T01:30:00Z", last_run: null, created_at: "2026-11-01T00:00:00Z" };
const RUN = { id: "5e1e0000-0000-4000-8000-0000000000a1", sweep_id: S, state: "done", started_at: "2026-11-09T01:30:00Z", counts: { found: 3, new: 3 }, new_since_last_run: 3, trigger: "owner" };
afterEach(() => vi.unstubAllGlobals());
const stub = (body: unknown) => {
  const f = vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", f);
  return f;
};
const call = (f: ReturnType<typeof stub>, n = 0) => f.mock.calls[n] as unknown as [string, RequestInit];

describe("C1's weekly search routes (proposal docs/contracts/lead-finder-sweep.md; written against it, not in the API yet)", () => {
  it("lists with the budget and the most allowed", async () => {
    const f = stub({ items: [SWEEP], max_sweeps: 5, weekly_budget_paise: 0 });
    expect(await listSweeps("tok", T)).toMatchObject({ items: [{ id: S }], maxSweeps: 5, weeklyBudgetPaise: 0 });
    expect(call(f)[0]).toMatch(new RegExp(`/v1/tenants/${T}/lead-finder/sweeps$`));
  });
  it("create sends the owner's words, the language, the day, the hour and the cap; nothing else (no number, no id)", async () => {
    const f = stub(SWEEP);
    await createSweep("tok", T, { text: "  find new retailers in Jayanagar ", language: "te", weekday: 1, hour: 7, maxResults: 20 });
    expect(call(f)[1].method).toBe("POST");
    expect(JSON.parse(String(call(f)[1].body))).toEqual({ text: "find new retailers in Jayanagar", language: "te", weekday: 1, hour: 7, max_results: 20 });
    await expect(createSweep("tok", T, { text: "x", language: "en", weekday: 1, hour: 7, maxResults: 20 })).rejects.toThrow();
    await expect(createSweep("tok", T, { text: "find shops in Eluru", language: "en", weekday: 8, hour: 7, maxResults: 20 })).rejects.toThrow();
  });
  it("change is a PUT of only what changed (true resumes, false pauses); an empty change is not sent", async () => {
    const f = stub(SWEEP);
    await changeSweep("tok", T, S, { enabled: false });
    expect(call(f)[1].method).toBe("PUT");
    expect(JSON.parse(String(call(f)[1].body))).toEqual({ enabled: false });
    expect(String(call(f)[0])).toMatch(new RegExp(`/sweeps/${S}$`));
    await changeSweep("tok", T, S, { weekday: 3, hour: 0, maxResults: 5 });
    expect(JSON.parse(String(call(f, 1)[1].body))).toEqual({ weekday: 3, hour: 0, max_results: 5 });
    await expect(changeSweep("tok", T, S, {})).rejects.toThrow();
    await expect(changeSweep("tok", T, "../x", { enabled: true })).rejects.toThrow();
  });
  it("run now, remove and the runs use the contract's own verbs; an answer that does not fit is an error, not a guess", async () => {
    const f = stub(RUN);
    expect(await runSweepNow("tok", T, S)).toMatchObject({ state: "done", trigger: "owner", newSinceLastRun: 3 });
    expect(String(call(f)[0])).toMatch(new RegExp(`/sweeps/${S}/run$`));
    expect(call(f)[1].method).toBe("POST");
    const g = stub({ removed: true });
    await removeSweep("tok", T, S);
    expect(String(call(g)[0])).toMatch(new RegExp(`/sweeps/${S}/remove$`));
    stub({ removed: false });
    await expect(removeSweep("tok", T, S)).rejects.toThrow();
    const h = stub({ items: [RUN] });
    expect(await listSweepRuns("tok", T, S, 999)).toHaveLength(1);
    expect(String(call(h)[0])).toMatch(/\/runs\?limit=50$/);
    stub({ nope: true });
    await expect(runSweepNow("tok", T, S)).rejects.toThrow();
    await expect(listSweeps("tok", T)).rejects.toThrow();
  });
});
