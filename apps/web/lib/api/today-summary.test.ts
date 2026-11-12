// @vitest-environment node
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// (React's `cache` remembers per request on the server; here one remembers per test, so the page's "prime" can be seen by the reads after it)
vi.mock("react", async (orig) => {
  const real = await orig<typeof import("react")>();
  return { ...real, cache: <A extends unknown[], R>(fn: (...a: A) => R) => { let v: { r: R } | undefined; return (...a: A) => (v ??= { r: fn(...a) }).r; } };
});

const T = "22222222-2222-4222-8222-222222222222";
const Q1 = "44444444-4444-4444-8444-444444444444";
const E1 = "55555555-5555-4555-8555-555555555555";
const LEAD = "66666666-6666-4666-8666-666666666666";
const AS_OF = "2026-11-12T10:22:07Z"; // India day 2026-11-12
const ok = (data: unknown) => ({ state: "ok", data });
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });
const calls = (f: ReturnType<typeof vi.fn>) => f.mock.calls.map((c) => String(c[0]).replace("http://api.test", ""));
const SUMMARY = `/v1/tenants/${T}/today/summary`;

let f: ReturnType<typeof vi.fn>;
async function load() {
  vi.resetModules();
  return { client: await import("./client"), sum: await import("./today-summary") };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "http://api.test");
  vi.stubEnv("TODAY_SUMMARY_SCREENS", "1");
  f = vi.fn();
  vi.stubGlobal("fetch", f);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the Today summary reader (TODAY_SUMMARY_SCREENS=1)", () => {
  it("after the page primed it, the routes the summary ran are answered from the ONE request, with the same path and query", async () => {
    f.mockImplementation(async () => json({ as_of: AS_OF, sections: { today: ok({ t: 1 }), visits_today: ok({ v: 1 }), visit_slots: ok({ s: 1 }), visits_proposed: ok({ p: 1 }), quotes: ok([{ id: Q1 }]), lead_desk_tasks: ok([]), lead_finder_prospects: ok({ items: [] }) } }));
    const { client, sum } = await load();
    sum.primeTodaySummary("tok", T, []);
    const get = (p: string) => client.apiRequest(`/v1/tenants/${T}${p}`, "tok");
    expect(await get("/today")).toEqual({ t: 1 });
    expect(await get("/visits/today")).toEqual({ v: 1 });
    expect(await get("/visits/slots?date=2026-11-12")).toEqual({ s: 1 });
    expect(await get("/visits?from=2026-11-12&to=2027-01-12&status=booked")).toEqual({ p: 1 });
    expect(await get("/quotes?limit=50")).toEqual([{ id: Q1 }]);
    expect(await get("/tasks?limit=100")).toEqual([]);
    expect(await get("/prospects?status=needs_owner&limit=5")).toEqual({ items: [] });
    expect(calls(f)).toEqual([SUMMARY]);
  });

  it("sends `skip` for the parts the page will not draw, and never asks for them (the route is asked on its own)", async () => {
    f.mockImplementation(async (url: string) => (String(url).includes("/today/summary") ? json({ as_of: AS_OF, sections: { today: ok({}) } }) : json({ own: true })));
    const { client, sum } = await load();
    sum.primeTodaySummary("tok", T, ["lead_desk_rules", "lead_finder_stats"]);
    expect(await client.apiRequest(`/v1/tenants/${T}/outreach/rules`, "tok")).toEqual({ own: true });
    expect(calls(f)).toEqual([`${SUMMARY}?skip=lead_desk_rules,lead_finder_stats`, `/v1/tenants/${T}/outreach/rules`]);
  });

  it("off by default: no summary is asked, every route asks itself", async () => {
    vi.stubEnv("TODAY_SUMMARY_SCREENS", "");
    f.mockImplementation(async () => json({ own: true }));
    const { client, sum } = await load();
    sum.primeTodaySummary("tok", T, []);
    await client.apiRequest(`/v1/tenants/${T}/today`, "tok");
    expect(calls(f)).toEqual([`/v1/tenants/${T}/today`]);
  });

  it("never primed, a write, another workspace, another query, another day: the route asks itself", async () => {
    f.mockImplementation(async (url: string) => (String(url).includes("/today/summary") ? json({ as_of: AS_OF, sections: { today: ok("from summary"), quotes: ok("q50"), visit_slots: ok("slots"), visits_proposed: ok("p") } }) : json({ own: true })));
    const { client, sum } = await load();
    expect(await client.apiRequest(`/v1/tenants/${T}/today`, "tok")).toEqual({ own: true });
    sum.primeTodaySummary("tok", T, []);
    expect(await client.apiRequest(`/v1/tenants/${T}/today`, "tok", { method: "POST", body: "{}" })).toEqual({ own: true });
    expect(await client.apiRequest(`/v1/tenants/33333333-3333-4333-8333-333333333333/today`, "tok")).toEqual({ own: true });
    expect(await client.apiRequest(`/v1/tenants/${T}/quotes?limit=20`, "tok")).toEqual({ own: true });
    expect(await client.apiRequest(`/v1/tenants/${T}/visits/slots?date=2026-11-13`, "tok")).toEqual({ own: true });
    expect(await client.apiRequest(`/v1/tenants/${T}/visits?from=2026-11-12&to=2026-12-01&status=booked`, "tok")).toEqual({ own: true });
    expect(await client.apiRequest(`/v1/tenants/${T}/today`, "tok")).toBe("from summary");
  });

  it("not_for_you answers as the route would (a 403) and a 4xx part as its status; a 5xx or timed-out part and an absent section fall back to the route", async () => {
    f.mockImplementation(async (url: string) =>
      String(url).includes("/today/summary")
        ? json({ as_of: AS_OF, sections: { outbox_settings: { state: "not_for_you" }, lead_desk_rules: { state: "error", error: { code: "forbidden", status: 403 } }, quotes: { state: "error", error: { code: "busy", status: 503 } }, lead_desk_handoffs: { state: "error", error: { code: "upstream", status: 502 } } } })
        : json({ own: true }),
    );
    const { client, sum } = await load();
    sum.primeTodaySummary("tok", T, []);
    await expect(client.apiRequest(`/v1/tenants/${T}/outbox/settings`, "tok")).rejects.toMatchObject({ status: 403 });
    await expect(client.apiRequest(`/v1/tenants/${T}/outreach/rules`, "tok")).rejects.toMatchObject({ status: 403 });
    expect(await client.apiRequest(`/v1/tenants/${T}/quotes?limit=50`, "tok")).toEqual({ own: true });
    expect(await client.apiRequest(`/v1/tenants/${T}/outreach/handoffs?open=true`, "tok")).toEqual({ own: true });
    expect(await client.apiRequest(`/v1/tenants/${T}/agents/status`, "tok")).toEqual({ own: true }); // (absent)
  });

  it("a slow section is followed up ONCE through its retry path, however many readers ask", async () => {
    f.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.endsWith("?only=lead_finder_prospects")) return json({ as_of: AS_OF, sections: { lead_finder_prospects: ok({ items: [1] }) } });
      return json({ as_of: AS_OF, sections: { lead_finder_prospects: { state: "slow", retry: "/today/summary?only=lead_finder_prospects" } } });
    });
    const { client, sum } = await load();
    sum.primeTodaySummary("tok", T, []);
    const q = `/v1/tenants/${T}/prospects?status=needs_owner&limit=5`;
    expect(await Promise.all([client.apiRequest(q, "tok"), client.apiRequest(q, "tok")])).toEqual([{ items: [1] }, { items: [1] }]);
    expect(calls(f)).toEqual([SUMMARY, `${SUMMARY}?only=lead_finder_prospects`]);
  });

  it("a slow section that is still not done after its follow-up, or whose retry is not the contract's path, is asked on its own route", async () => {
    f.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes("/today/summary?only=")) return json({ as_of: AS_OF, sections: { quotes: { state: "slow", retry: "/today/summary?only=quotes" } } });
      if (u.includes("/today/summary")) return json({ as_of: AS_OF, sections: { quotes: { state: "slow", retry: "/today/summary?only=quotes" }, lead_desk_rules: { state: "slow", retry: "https://evil.test/x" } } });
      return json({ own: true });
    });
    const { client, sum } = await load();
    sum.primeTodaySummary("tok", T, []);
    expect(await client.apiRequest(`/v1/tenants/${T}/quotes?limit=50`, "tok")).toEqual({ own: true });
    expect(await client.apiRequest(`/v1/tenants/${T}/outreach/rules`, "tok")).toEqual({ own: true });
    expect(calls(f).filter((c) => c.includes("evil"))).toEqual([]);
  });

  it("an API without the route (404) or unreachable: every read asks its own route (the old path)", async () => {
    f.mockImplementation(async (url: string) => (String(url).includes("/today/summary") ? json({ error: { code: "not_found" } }, 404) : json({ own: true })));
    const { client, sum } = await load();
    sum.primeTodaySummary("tok", T, []);
    expect(await client.apiRequest(`/v1/tenants/${T}/today`, "tok")).toEqual({ own: true });
    expect(await client.apiRequest(`/v1/tenants/${T}/visits/today`, "tok")).toEqual({ own: true });
  });

  it("an API that refuses the whole request as busy makes every part busy: no fallback reads are piled on top", async () => {
    f.mockImplementation(async () => json({ error: { code: "busy", message: "busy", retry_after: 0 } }, 503, { "Retry-After": "0" }));
    const { client, sum } = await load();
    sum.primeTodaySummary("tok", T, []);
    const read = client.apiRequest(`/v1/tenants/${T}/visits/today`, "tok").catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await read).toMatchObject({ status: 503 });
    expect(calls(f)).toEqual([SUMMARY, SUMMARY]); // (asked twice, then the part is busy)
  });

  it("a rejected session (401) is thrown to the reader, so the page sends the person to sign in", async () => {
    f.mockImplementation(async () => json({ error: { code: "unauthorized", message: "no" } }, 401));
    const { client, sum } = await load();
    sum.primeTodaySummary("tok", T, []);
    await expect(client.apiRequest(`/v1/tenants/${T}/today`, "tok")).rejects.toBeInstanceOf(client.ApiAuthError);
  });

  it("the per-batch items come from `lead_desk_batch_items`, and a batch it did not read is asked on its own", async () => {
    const B1 = "77777777-7777-4777-8777-777777777777";
    const B2 = "88888888-8888-4888-8888-888888888888";
    f.mockImplementation(async (url: string) => (String(url).includes("/today/summary") ? json({ as_of: AS_OF, sections: { lead_desk_batch_items: ok({ [B1]: { items: [1] } }) } }) : json({ own: true })));
    const { client, sum } = await load();
    sum.primeTodaySummary("tok", T, []);
    expect(await client.apiRequest(`/v1/tenants/${T}/outreach/batches/${B1}/items`, "tok")).toEqual({ items: [1] });
    expect(await client.apiRequest(`/v1/tenants/${T}/outreach/batches/${B2}/items`, "tok")).toEqual({ own: true });
  });

  it("the derived sections: a call's brief (checked like the call route's) and a quote's enquiry; absent = ask the route, present but empty = nothing", async () => {
    f.mockImplementation(async () => json({ as_of: AS_OF, sections: { call_briefs: ok({ c1: { lead_id: LEAD, summary_short: " Wants a visit ", visit_at: "2026-11-13T10:00:00Z" }, c2: { lead_id: "not-a-uuid", summary_short: "x".repeat(400), visit_at: "nope" } }), quote_enquiries: ok({ [Q1]: E1 }) } }));
    const { sum } = await load();
    sum.primeTodaySummary("tok", T, []);
    expect(await sum.summaryBrief(T, "c1")).toEqual({ leadId: LEAD, gist: "Wants a visit", visitAt: "2026-11-13T10:00:00Z" });
    expect(await sum.summaryBrief(T, "c2")).toEqual({ leadId: null, gist: null, visitAt: null });
    expect(await sum.summaryBrief(T, "c3")).toBeNull();
    expect(await sum.summaryEnquiry(T, Q1)).toBe(E1);
    expect(await sum.summaryEnquiry(T, "99999999-9999-4999-8999-999999999999")).toBeNull();
  });

  it("derived sections that are absent, skipped or not primed leave the old reads in charge (undefined)", async () => {
    f.mockImplementation(async () => json({ as_of: AS_OF, sections: { today: ok({}) } }));
    const { sum } = await load();
    expect(await sum.summaryBrief(T, "c1")).toBeUndefined(); // (not primed)
    sum.primeTodaySummary("tok", T, ["call_briefs"]);
    expect(await sum.summaryBrief(T, "c1")).toBeUndefined(); // (skipped)
    expect(await sum.summaryEnquiry(T, Q1)).toBeUndefined(); // (absent: wave 2 had nothing, or its input was not ok)
  });

  it("summarySkip: a Viewer draws no desk, finder or proposals; a flag that is off skips its reads; an Owner with everything on skips nothing", async () => {
    const { sum } = await load();
    const all = { finderOn: true, outreachOn: true, tasksOn: true, leadsOn: true };
    expect(sum.summarySkip({ role: "owner", ...all })).toEqual([]);
    expect(sum.summarySkip({ role: "admin", ...all })).toEqual([]);
    expect(sum.summarySkip({ role: "sales", ...all })).toEqual(["ai_usage_week", "outbox_settings", "lead_desk_rules", "lead_desk_tasks", "lead_desk_leads"]);
    expect(sum.summarySkip({ role: "viewer", ...all })).toEqual(expect.arrayContaining(["visits_proposed", "lead_desk_batches", "lead_desk_handoffs", "lead_finder_prospects", "lead_finder_stats", "ai_usage_week"]));
    expect(sum.summarySkip({ role: "owner", finderOn: false, outreachOn: false, tasksOn: false, leadsOn: false })).toEqual(["lead_desk_batches", "lead_desk_handoffs", "lead_desk_rules", "lead_desk_tasks", "lead_desk_leads", "lead_finder_prospects", "lead_finder_stats"]);
  });
});

// The contract's table once left out the /outreach prefix and so did this reader (every desk section was asked on its own route): the routes are pinned against the API's own section table.
describe("the routes this reader matches are the ones the API's summary runs", () => {
  const api = readFileSync(new URL("../../../../services/ai-api/app/bootstrap/today_summary.py", import.meta.url), "utf8");
  const ran = new Map<string, string>();
  for (const m of api.matchAll(/Wave1\("(\w+)",\s*\w+,\s*"([^"{}]+)"\)/g)) ran.set(m[1], m[2]);
  for (const m of api.matchAll(/read_when\("\w+",\s*"([^"]+)"\)/g)) ran.set(m[1].split("?")[0] === "/outbox/approvals" ? "outbox_approvals" : "call_requests", m[1]);
  it("every fixed route has the API's path and query, section by section", async () => {
    const { FIXED } = await import("./today-summary");
    const sorted = (q: string) => [...new URLSearchParams(q)].map(([k, v]) => `${k}=${v}`).sort().join("&");
    expect(ran.size).toBeGreaterThanOrEqual(13);
    for (const [route, [name, query]] of Object.entries(FIXED)) {
      const path = ran.get(name);
      expect(path, `section ${name} is not in the API's table`).toBeDefined();
      const [p, q = ""] = (path as string).split("?");
      expect({ name, route: p, query: sorted(q) }).toEqual({ name, route, query: sorted(query) });
    }
  });
  it("the per-batch items route has the API's /outreach prefix", () => {
    expect(api).toContain('/outreach/batches/{i}/items');
  });
});

