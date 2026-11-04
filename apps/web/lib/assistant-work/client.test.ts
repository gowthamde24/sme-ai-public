import { describe, expect, it } from "vitest";

import { fixtureTransport, routeTransport } from "./client";
import { ACTIVITY_JSON, HOURS_PLAN_JSON, IMPORT_PLAN_JSON, PLAN_HOURS_ID, PLAN_IMPORT_ID, PLAN_STAFF_ID, STAFF_PLAN_JSON } from "./fixtures";

const BASE = "/app/tenants/t";
function fakeFetch(answer: unknown, status = 200) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
    return new Response(JSON.stringify(answer), { status, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
  return { calls, fetcher };
}

describe("routeTransport: this workspace's own route, one op each", () => {
  it("Do it sends the plan, the decision and whether the Owner confirmed; the answer is read strictly", async () => {
    const { calls, fetcher } = fakeFetch({ ok: true, plan: { ...IMPORT_PLAN_JSON, status: "done" } });
    const out = await routeTransport(BASE, fetcher).decide(PLAN_IMPORT_ID, "do", false);
    expect(calls).toEqual([{ url: `${BASE}/assistant-work`, body: { op: "decide", planId: PLAN_IMPORT_ID, decision: "do", confirmed: false } }]);
    expect(out).toMatchObject({ ok: true, plan: { status: "done" } });
  });
  it("a refusal is a closed word; an odd answer or a failed request is 'down'", async () => {
    expect(await routeTransport(BASE, fakeFetch({ ok: false, error: "mfa" }).fetcher).decide(PLAN_IMPORT_ID, "do", true)).toEqual({ ok: false, error: "mfa" });
    expect(await routeTransport(BASE, fakeFetch({ ok: false, error: "The API said: <b>no</b>" }).fetcher).undo(PLAN_IMPORT_ID)).toEqual({ ok: false, error: "down" });
    expect(await routeTransport(BASE, fakeFetch({ ok: true, plan: { title: "no id" } }).fetcher).undo(PLAN_IMPORT_ID)).toEqual({ ok: false, error: "down" });
    expect(await routeTransport(BASE, fakeFetch({}, 500).fetcher).undo(PLAN_IMPORT_ID)).toEqual({ ok: false, error: "down" });
  });
  it("a key goes in its own call and only four characters come back", async () => {
    const { calls, fetcher } = fakeFetch({ ok: true, last4: "9f3a" });
    expect(await routeTransport(BASE, fetcher).saveSecret("c1000000-0000-4000-8000-000000000001", "IM-KEY-secret-9f3a")).toEqual({ ok: true, last4: "9f3a" });
    expect(calls[0].body).toEqual({ op: "secret", requestId: "c1000000-0000-4000-8000-000000000001", value: "IM-KEY-secret-9f3a" });
    expect(await routeTransport(BASE, fakeFetch({ ok: true, last4: "too-long-to-be-four" }).fetcher).saveSecret("c1000000-0000-4000-8000-000000000001", "x")).toEqual({ ok: true, last4: null });
  });
  it("a live test and an Activity undo", async () => {
    expect(await routeTransport(BASE, fakeFetch({ ok: true, result: { ok: false, reason: "key_rejected", detail: "IndiaMART said 401" } }).fetcher).liveTest("d1000000-0000-4000-8000-000000000001", "pull_now")).toMatchObject({ ok: true, result: { ok: false, reason: "key_rejected" } });
    expect(await routeTransport(BASE, fakeFetch({ ok: true, entry: { ...ACTIVITY_JSON.items[0], status: "undone", undo: "done" } }).fetcher).undoAction(ACTIVITY_JSON.items[0].action_id)).toMatchObject({ ok: true, entry: { status: "undone" } });
    expect(await routeTransport(BASE, fakeFetch({ ok: false, error: "expired" }).fetcher).undoAction(ACTIVITY_JSON.items[0].action_id)).toEqual({ ok: false, error: "expired" });
  });
});

describe("fixtureTransport: made-up answers, nothing leaves the page", () => {
  it("runs a plan, undoes it, and refuses to run it twice", async () => {
    const t = fixtureTransport({ delay: 0 });
    const done = await t.decide(PLAN_IMPORT_ID, "do", false);
    expect(done).toMatchObject({ ok: true, plan: { status: "done" } });
    expect(await t.decide(PLAN_IMPORT_ID, "do", false)).toEqual({ ok: false, error: "state" });
    const undone = await t.undo(PLAN_IMPORT_ID);
    expect(undone).toMatchObject({ ok: true, plan: { status: "undone" } });
    if (undone.ok) expect(undone.plan.steps.every((s) => s.status === "undone")).toBe(true);
  });
  it("a sensitive plan does not run without the Owner's confirm", async () => {
    const t = fixtureTransport({ delay: 0 }, [STAFF_PLAN_JSON]);
    expect(await t.decide(PLAN_STAFF_ID, "do", false)).toEqual({ ok: false, error: "state" });
    expect(await t.decide(PLAN_STAFF_ID, "do", true)).toMatchObject({ ok: true, plan: { status: "done" } });
  });
  it("a failing tool makes the plan partly done, honestly", async () => {
    const t = fixtureTransport({ delay: 0, failTools: ["leads.tag"] });
    const out = await t.decide(PLAN_IMPORT_ID, "do", false);
    expect(out).toMatchObject({ ok: true, plan: { status: "partly_done" } });
    if (out.ok) expect(out.plan.steps.map((s) => s.status)).toEqual(["done", "failed"]);
    const all = fixtureTransport({ delay: 0, failTools: ["calls.set_hours"] }, [HOURS_PLAN_JSON]);
    expect(await all.decide(PLAN_HOURS_ID, "do", false)).toMatchObject({ ok: true, plan: { status: "failed" } });
  });
  it("an upload reports its progress and gives an id", async () => {
    const seen: number[] = [];
    const out = await fixtureTransport({ delay: 0 }).upload(new File(["a,b\n1,2"], "leads.csv", { type: "text/csv" }), (f) => seen.push(f), new AbortController().signal);
    expect(seen).toEqual([0.25, 0.5, 0.75, 1]);
    expect(out).toMatchObject({ ok: true, file: { name: "leads.csv", kind: "sheet" } });
    const down = await fixtureTransport({ delay: 0, uploadDown: true }).upload(new File(["x"], "a.csv"), () => undefined, new AbortController().signal);
    expect(down).toEqual({ ok: false, error: "down" });
  });
  it("a key shorter than 8 characters is refused; a good one answers its last four only", async () => {
    const t = fixtureTransport({ delay: 0 });
    expect(await t.saveSecret("c", "short")).toEqual({ ok: false, error: "rejected" });
    expect(await t.saveSecret("c", "IM-abcdef-7781")).toEqual({ ok: true, last4: "7781" });
  });
});
