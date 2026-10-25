// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { onRequestError } from "@/instrumentation";
import { buildEnvelope, buildEvent, frames, parseDsn, reportServerError, safeFile } from "./report";

const DSN = "https://0123456789abcdef@o123.ingest.sentry.io/456";
const PII = "Meena (9876543210) asked about the marks of Asha";

function leaky(): Error {
  const e = new TypeError(PII);
  e.stack = `TypeError: ${PII}\n    at renderCard (/srv/app/.next/server/chunks/ssr/abc.js:10:5)\n    at Object.run (/Users/someone/project/node_modules/react/index.js:3:9)\n    at /srv/app/.next/server/app/page.js:2:1`;
  return e;
}

describe("the DSN", () => {
  it("is read when it is a https project address and not otherwise", () => {
    expect(parseDsn(DSN)).toEqual({ key: "0123456789abcdef", host: "o123.ingest.sentry.io", projectId: "456" });
    for (const bad of [undefined, null, "", "http://k@h/1", "https://nokey/1", "https://k@h/notanumber", "ftp://0123456789abcdef@h/1", "https://0123456789abcdef@h/1/extra"]) expect(parseDsn(bad as string)).toBeNull();
  });
});

describe("what an event holds", () => {
  const env = { release: "r1", environment: "staging" };
  it("is the class name, the frames and the route pattern, and no message", () => {
    const event = buildEvent(leaky(), { routePath: "/app/tenants/[tenantId]/today", routeType: "render", digest: "d123" }, env, new Date(0), "e".repeat(32));
    const text = JSON.stringify(event);
    for (const secret of ["Meena", "9876543210", "Asha", "marks", "someone", "/srv/app"]) expect(text).not.toContain(secret);
    expect((event.exception as { values: { type: string }[] }).values[0].type).toBe("TypeError");
    expect(event.tags).toEqual({ surface: "web-server", route: "/app/tenants/[tenantId]/today", route_type: "render", digest: "d123" });
    expect(Object.keys(event).sort()).toEqual(["environment", "event_id", "exception", "level", "platform", "release", "server_name", "tags", "timestamp"]);
  });
  it("keeps frames inside the build, oldest first, with no source line", () => {
    const f = frames(leaky().stack);
    expect(f.map((x) => x.function)).toEqual(["?", "Object.run", "renderCard"]);
    expect(f[2]).toEqual({ filename: ".next/server/chunks/ssr/abc.js", function: "renderCard", lineno: 10, colno: 5, in_app: true });
    expect(f[1].in_app).toBe(false);
  });
  it("never carries a path of the machine", () => {
    expect(safeFile("/Users/x/work/app/lib/a.ts")).toBe("lib/a.ts");
    expect(safeFile("file:///srv/app/.next/server/a.js?x=1")).toBe(".next/server/a.js");
  });
  it("drops a route or a digest that does not look like one (an address with an id or a token in it)", () => {
    const event = buildEvent(new Error("x"), { routePath: "/app/tenants/9876543210?token=abc def", routeType: "x y", digest: "a b c" }, env);
    expect(event.tags).toEqual({ surface: "web-server" });
  });
  it("copes with a thrown string or nothing", () => {
    expect((buildEvent("secret words", {}, env).exception as { values: { type: string }[] }).values[0].type).toBe("Error");
    expect(JSON.stringify(buildEvent(undefined, {}, env))).not.toContain("undefined");
  });
  it("is an envelope of three lines", () => {
    const event = buildEvent(new Error("x"), {}, env, new Date(0), "f".repeat(32));
    const lines = buildEnvelope(event, DSN, new Date(0)).split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0])).toEqual({ event_id: "f".repeat(32), sent_at: "1970-01-01T00:00:00.000Z", dsn: DSN });
    expect(JSON.parse(lines[1])).toEqual({ type: "event" });
  });
});

describe("reporting", () => {
  it("does nothing without a DSN: nothing is sent", async () => {
    const send = vi.fn();
    expect(await reportServerError(leaky(), {}, {} as NodeJS.ProcessEnv, send as unknown as typeof fetch)).toBe(false);
    expect(await reportServerError(leaky(), {}, { SENTRY_DSN: "nonsense" } as unknown as NodeJS.ProcessEnv, send as unknown as typeof fetch)).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
  it("posts one envelope to the project's address with the key, and the body has nothing a person said", async () => {
    const send = vi.fn().mockResolvedValue({ ok: true });
    const ok = await reportServerError(leaky(), { routePath: "/app/today", routeType: "render" }, { SENTRY_DSN: DSN, SENTRY_ENVIRONMENT: "staging", SENTRY_RELEASE: "abc" } as unknown as NodeJS.ProcessEnv, send as unknown as typeof fetch);
    expect(ok).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    const [url, init] = send.mock.calls[0] as [string, { method: string; headers: Record<string, string>; body: string }];
    expect(url).toBe("https://o123.ingest.sentry.io/api/456/envelope/");
    expect(init.method).toBe("POST");
    expect(init.headers["x-sentry-auth"]).toContain("sentry_key=0123456789abcdef");
    for (const secret of ["Meena", "9876543210", "Asha"]) expect(init.body).not.toContain(secret);
  });
  it("never throws and never reports success when the network fails", async () => {
    const send = vi.fn().mockRejectedValue(new Error("offline"));
    await expect(reportServerError(leaky(), {}, { SENTRY_DSN: DSN } as unknown as NodeJS.ProcessEnv, send as unknown as typeof fetch)).resolves.toBe(false);
    const refused = vi.fn().mockResolvedValue({ ok: false });
    await expect(reportServerError(leaky(), {}, { SENTRY_DSN: DSN } as unknown as NodeJS.ProcessEnv, refused as unknown as typeof fetch)).resolves.toBe(false);
  });
});

describe("Next's hook", () => {
  it("is a no-op while SENTRY_DSN is unset", async () => {
    const send = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true } as Response);
    delete process.env.SENTRY_DSN;
    await onRequestError(leaky(), { path: "/app/tenants/9876543210/today?token=secret", method: "GET" }, { routePath: "/app/tenants/[tenantId]/today", routeType: "render" });
    expect(send).not.toHaveBeenCalled();
    send.mockRestore();
  });
  it("reports the route pattern and never the address that was asked for", async () => {
    const send = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true } as Response);
    process.env.SENTRY_DSN = DSN;
    try {
      await onRequestError(Object.assign(leaky(), { digest: "dg1" }), { path: "/app/tenants/9876543210/today?token=secret", method: "GET" }, { routePath: "/app/tenants/[tenantId]/today", routeType: "render" });
      const body = String((send.mock.calls[0][1] as { body: string }).body);
      expect(body).toContain("/app/tenants/[tenantId]/today");
      for (const secret of ["9876543210", "token=secret", "Meena"]) expect(body).not.toContain(secret);
    } finally {
      delete process.env.SENTRY_DSN;
      send.mockRestore();
    }
  });
});
