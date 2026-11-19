// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// (React's `cache` remembers per request on the server; here one remembers per test, as one request does)
vi.mock("react", async (orig) => {
  const real = await orig<typeof import("react")>();
  return { ...real, cache: <A extends unknown[], R>(fn: (...a: A) => R) => { let v: { r: R } | undefined; return (...a: A) => (v ??= { r: fn(...a) }).r; } };
});
const hdr = new Map<string, string>();
vi.mock("next/headers", () => ({ headers: async () => ({ get: (n: string) => hdr.get(n) ?? null }) }));

async function load() {
  vi.resetModules();
  const timing = await import("./server-timing");
  const { ServerTimingReport } = await import("./ServerTimingReport");
  return { ...timing, ServerTimingReport };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
beforeEach(() => {
  hdr.clear();
  hdr.set("x-sme-path", "/app/tenants/11111111-1111-4111-8111-111111111111?secret=1");
  vi.stubEnv("SERVER_TIMING", "1");
});
afterEach(() => vi.unstubAllEnvs());

describe("the Server-Timing report at the end of the stream", () => {
  it("writes the spans once the render is quiet, as data (a JSON script) and as one log line, relative to the proxy's start, with numbers and fixed names only", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { timed, mark, ServerTimingReport } = await load();
    hdr.set("x-sme-t0", String(performance.timeOrigin + performance.now() - 50));
    await timed("session", () => sleep(20));
    mark("app_shell");
    const html = renderToStaticMarkup(await ServerTimingReport());
    expect(html).toContain('<template id="srv-timing" data-spans="');
    const body = JSON.parse(/data-spans="([^"]*)"/.exec(html)?.[1].replace(/&quot;/g, '"') ?? "null") as { v: number; spans: { n: string; s: number; d: number }[] };
    expect(body.v).toBe(1);
    expect(body.spans.map((x) => x.n)).toEqual(["session", "app_shell"]);
    expect(body.spans[0].s).toBeGreaterThanOrEqual(45); // 50 ms after the proxy took the request, give or take the clock
    expect(body.spans[0].d).toBeGreaterThanOrEqual(15);
    expect(html).not.toMatch(/secret|11111111|tok/);
    expect(info).toHaveBeenCalledTimes(1);
    expect(String(info.mock.calls[0][0])).toBe("[server-timing]");
    info.mockRestore();
  }, 15_000);

  it("draws nothing with the switch off, and nothing on a page outside a workspace", async () => {
    const { timed, ServerTimingReport } = await load();
    await timed("session", () => sleep(1));
    hdr.set("x-sme-path", "/app");
    expect(await ServerTimingReport()).toBeNull();
    vi.stubEnv("SERVER_TIMING", "");
    hdr.set("x-sme-path", "/app/tenants/x");
    expect(await ServerTimingReport()).toBeNull();
  });
});
