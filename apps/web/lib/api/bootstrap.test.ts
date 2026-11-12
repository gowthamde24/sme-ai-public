// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// (React's `cache` remembers per request on the server; here one remembers per test, so the layout's "prime" can be seen by the reads after it)
vi.mock("react", async (orig) => {
  const real = await orig<typeof import("react")>();
  return { ...real, cache: <A extends unknown[], R>(fn: (...a: A) => R) => { let v: { r: R } | undefined; return (...a: A) => (v ??= { r: fn(...a) }).r; } };
});

const T = "22222222-2222-4222-8222-222222222222";
const ok = (data: unknown) => ({ ok: true, data, error: null });
const bad = (code: string, status: number) => ({ ok: false, data: null, error: { code, status } });
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });
const calls = (f: ReturnType<typeof vi.fn>) => f.mock.calls.map((c) => String(c[0]).replace("http://api.test", ""));

let f: ReturnType<typeof vi.fn>;
async function load() {
  vi.resetModules();
  return { client: await import("./client"), boot: await import("./bootstrap") };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "http://api.test");
  vi.stubEnv("BOOTSTRAP", "1");
  f = vi.fn();
  vi.stubGlobal("fetch", f);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the bootstrap reader (BOOTSTRAP=1, C1's Phase 1)", () => {
  it("after the layout primed it, the layout's routes are answered from the ONE request, and nothing else is asked", async () => {
    f.mockImplementation(async () => json({ parts: { tenant: ok({ id: T, name: "Acme" }), today: ok({ cards: [] }), pack: ok({ p: 1 }) }, generated_at: "2026-11-12T12:00:00Z" }));
    const { client, boot } = await load();
    boot.primeBootstrap("tok", T);
    expect(await client.apiRequest(`/v1/tenants/${T}`, "tok")).toEqual({ id: T, name: "Acme" });
    expect(await client.apiRequest(`/v1/tenants/${T}/today`, "tok")).toEqual({ cards: [] });
    expect(await client.apiRequest(`/v1/tenants/${T}/pack`, "tok")).toEqual({ p: 1 });
    expect(calls(f)).toEqual([`/v1/tenants/${T}/bootstrap`]);
  });
  it("off by default: no bootstrap is asked, every route asks itself", async () => {
    vi.stubEnv("BOOTSTRAP", "");
    f.mockImplementation(async () => json({ ok: 1 }));
    const { client, boot } = await load();
    boot.primeBootstrap("tok", T);
    await client.apiRequest(`/v1/tenants/${T}/today`, "tok");
    expect(calls(f)).toEqual([`/v1/tenants/${T}/today`]);
  });
  it("never primed (a route handler): the route asks itself; a route that is not a part, a write and another workspace are never answered from it", async () => {
    f.mockImplementation(async (url: string) => (String(url).endsWith("/bootstrap") ? json({ parts: { today: ok("from bootstrap") } }) : json({ own: true })));
    const { client, boot } = await load();
    expect(await client.apiRequest(`/v1/tenants/${T}/today`, "tok")).toEqual({ own: true });
    boot.primeBootstrap("tok", T);
    expect(await client.apiRequest(`/v1/tenants/${T}/nav-counts`, "tok")).toEqual({ own: true });
    expect(await client.apiRequest(`/v1/tenants/${T}/today`, "tok", { method: "POST", body: "{}" })).toEqual({ own: true });
    expect(await client.apiRequest(`/v1/tenants/33333333-3333-4333-8333-333333333333/today`, "tok")).toEqual({ own: true });
    expect(await client.apiRequest(`/v1/tenants/${T}/today`, "tok")).toBe("from bootstrap");
  });
  it("a part that failed answers with the error its own route would give (the AI usage for a role that may not see it: 403), without asking the route again", async () => {
    f.mockImplementation(async () => json({ parts: { ai_usage: bad("forbidden", 403) } }));
    const { client, boot } = await load();
    boot.primeBootstrap("tok", T);
    const err = await client.apiRequest(`/v1/tenants/${T}/ai-usage`, "tok").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(client.ApiRequestError);
    expect((err as InstanceType<typeof client.ApiRequestError>).status).toBe(403);
    expect(calls(f)).toEqual([`/v1/tenants/${T}/bootstrap`]);
  });
  it("a part that timed out (503 busy), a part left out and an API without the route fall back to the part's own route", async () => {
    f.mockImplementation(async (url: string) => (String(url).endsWith("/bootstrap") ? json({ parts: { today: bad("busy", 503) } }) : json({ own: String(url) })));
    const { client, boot } = await load();
    boot.primeBootstrap("tok", T);
    expect(await client.apiRequest(`/v1/tenants/${T}/today`, "tok")).toEqual({ own: `http://api.test/v1/tenants/${T}/today` });
    expect(await client.apiRequest(`/v1/tenants/${T}/pack`, "tok")).toEqual({ own: `http://api.test/v1/tenants/${T}/pack` });
    const old = await load();
    f.mockImplementation(async (url: string) => (String(url).endsWith("/bootstrap") ? json({ error: { code: "not_found", message: "x" } }, 404) : json({ own: true })));
    old.boot.primeBootstrap("tok", T);
    expect(await old.client.apiRequest(`/v1/tenants/${T}/today`, "tok")).toEqual({ own: true });
  });
  it("the API refusing the WHOLE request as busy makes every part busy: one more ask after Retry-After, then no thirteen reads on top of it", async () => {
    f.mockImplementation(async () => json({ error: { code: "busy", message: "Busy." } }, 503, { "Retry-After": "2" }));
    const { client, boot } = await load();
    boot.primeBootstrap("tok", T);
    const a = client.apiRequest(`/v1/tenants/${T}/today`, "tok").catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(2100);
    const err = await a;
    expect(client.isBusy(err)).toBe(true);
    expect(calls(f).filter((u) => u.endsWith("/bootstrap"))).toHaveLength(2);
    expect(calls(f).filter((u) => !u.endsWith("/bootstrap"))).toHaveLength(0);
  });
  it("a rejected session is thrown to the reader", async () => {
    f.mockImplementation(async () => json({ error: { code: "unauthorized", message: "x" } }, 401));
    const { client, boot } = await load();
    boot.primeBootstrap("tok", T);
    await expect(client.apiRequest(`/v1/tenants/${T}/today`, "tok")).rejects.toBeInstanceOf(client.ApiAuthError);
  });
});

describe("the cap on reads at once reaches apiRequest (server)", () => {
  it("thirty reads for one person never have more than eight in flight, and all of them are answered", async () => {
    vi.stubEnv("BOOTSTRAP", "");
    let now = 0;
    let peak = 0;
    f.mockImplementation(async () => {
      now += 1;
      peak = Math.max(peak, now);
      await new Promise((r) => setTimeout(r, 5));
      now -= 1;
      return json({ ok: true });
    });
    const { client } = await load();
    const all = Array.from({ length: 30 }, (_, i) => client.apiRequest(`/v1/tenants/${T}/leads?n=${i}`, "tok-cap"));
    await vi.advanceTimersByTimeAsync(100);
    expect((await Promise.all(all)).length).toBe(30);
    expect(peak).toBeLessThanOrEqual(8);
    expect(peak).toBeGreaterThan(1);
  });
});
