// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// (React's `cache` remembers per request on the server; here one remembers per test, as one request does)
vi.mock("react", async (orig) => {
  const real = await orig<typeof import("react")>();
  return { ...real, cache: <A extends unknown[], R>(fn: (...a: A) => R) => { let v: { r: R } | undefined; return (...a: A) => (v ??= { r: fn(...a) }).r; } };
});

const T = "22222222-2222-4222-8222-222222222222";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const calls = (f: ReturnType<typeof vi.fn>) => f.mock.calls.map((c) => `${(c[1] as RequestInit | undefined)?.method ?? "GET"} ${String(c[0]).replace("http://api.test", "")}`);

let f: ReturnType<typeof vi.fn>;
async function load() {
  vi.resetModules();
  return { client: await import("./client"), memo: await import("./request-memo") };
}
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "http://api.test");
  vi.stubEnv("REQUEST_MEMO", "1");
  f = vi.fn();
  vi.stubGlobal("fetch", f);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("one read per request (REQUEST_MEMO=1)", () => {
  it("after a render activated it, identical reads (also at the same moment) are asked once and each asker gets its own copy", async () => {
    f.mockImplementation(async () => json({ id: T, tags: ["a"] }));
    const { client, memo } = await load();
    memo.activateRequestMemo();
    const path = `/v1/tenants/${T}`;
    const [a, b] = await Promise.all([client.apiRequest(path, "tok"), client.apiRequest(path, "tok")]);
    const c = await client.apiRequest(path, "tok");
    expect(calls(f)).toEqual([`GET ${path}`]);
    expect([a, b, c]).toEqual([{ id: T, tags: ["a"] }, { id: T, tags: ["a"] }, { id: T, tags: ["a"] }]);
    (a as { tags: string[] }).tags.push("changed");
    expect(await client.apiRequest(path, "tok")).toEqual({ id: T, tags: ["a"] }); // (nobody can change what another reads)
  });

  it("another path, another query and another person are other reads", async () => {
    f.mockImplementation(async () => json({}));
    const { client, memo } = await load();
    memo.activateRequestMemo();
    await client.apiRequest(`/v1/tenants/${T}/quotes?limit=20`, "tok");
    await client.apiRequest(`/v1/tenants/${T}/quotes?limit=50`, "tok");
    await client.apiRequest(`/v1/tenants/${T}/quotes?limit=50`, "other-person");
    expect(calls(f)).toHaveLength(3);
  });

  it("not activated (a route handler, a poll, an action before its render): every read is asked, as before", async () => {
    f.mockImplementation(async () => json({}));
    const { client } = await load();
    await client.apiRequest(`/v1/tenants/${T}/today`, "tok");
    await client.apiRequest(`/v1/tenants/${T}/today`, "tok");
    expect(calls(f)).toHaveLength(2);
  });

  it("off by default: activating does nothing", async () => {
    vi.stubEnv("REQUEST_MEMO", "");
    f.mockImplementation(async () => json({}));
    const { client, memo } = await load();
    memo.activateRequestMemo();
    await client.apiRequest(`/v1/tenants/${T}/today`, "tok");
    await client.apiRequest(`/v1/tenants/${T}/today`, "tok");
    expect(calls(f)).toHaveLength(2);
  });

  it("a write forgets what was read, so the read after it is fresh", async () => {
    let n = 0;
    f.mockImplementation(async (_u: string, init?: RequestInit) => json(init?.method === "POST" ? { done: true } : { n: ++n }));
    const { client, memo } = await load();
    memo.activateRequestMemo();
    const path = `/v1/tenants/${T}/visits/today`;
    expect(await client.apiRequest(path, "tok")).toEqual({ n: 1 });
    expect(await client.apiRequest(path, "tok")).toEqual({ n: 1 });
    await client.apiRequest(`/v1/tenants/${T}/visits`, "tok", { method: "POST", body: "{}" });
    expect(await client.apiRequest(path, "tok")).toEqual({ n: 2 });
    expect(calls(f)).toEqual([`GET ${path}`, `POST /v1/tenants/${T}/visits`, `GET ${path}`]);
  });

  it("a read that failed is not kept: the next one asks again; a rejected session reaches every asker", async () => {
    f.mockImplementationOnce(async () => json({ error: { code: "upstream", message: "x" } }, 502)).mockImplementation(async () => json({ ok: 1 }));
    const { client, memo } = await load();
    memo.activateRequestMemo();
    const path = `/v1/tenants/${T}/billing/access`;
    await expect(client.apiRequest(path, "tok")).rejects.toMatchObject({ status: 502 });
    expect(await client.apiRequest(path, "tok")).toEqual({ ok: 1 });
    f.mockReset();
    f.mockImplementation(async () => json({ error: { code: "unauthorized", message: "no" } }, 401));
    const other = `/v1/tenants/${T}/nav-counts`;
    const both = await Promise.allSettled([client.apiRequest(other, "tok"), client.apiRequest(other, "tok")]);
    expect(both.map((r) => r.status)).toEqual(["rejected", "rejected"]);
    expect(both[0].status === "rejected" && both[0].reason).toBeInstanceOf(client.ApiAuthError);
    expect(calls(f)).toHaveLength(1);
  });
});
