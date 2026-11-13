import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ tenant: vi.fn(), start: vi.fn(async (..._a: unknown[]) => ({ callId: "c" })), end: vi.fn(async (..._a: unknown[]) => undefined), demo: vi.fn(async (..._a: unknown[]) => true) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ accessToken: "tok" }) }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => h.tenant(...a) }));
vi.mock("@/lib/api/demo-call", () => ({ startDemoCall: (...a: unknown[]) => h.start(...a), endDemoCall: (...a: unknown[]) => h.end(...a) }));
vi.mock("./today-read", () => ({ readIsDemo: (...a: unknown[]) => h.demo(...a) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect ${to}`); } }));

import { endDemoCallAction, startDemoCallAction } from "./demo-call-actions";

const T = "22222222-2222-4222-8222-222222222222";
beforeEach(() => {
  h.tenant.mockReset().mockResolvedValue({ role: "owner", name: "Neelambari Silks (demo)" });
  h.start.mockClear();
  h.end.mockClear();
  h.demo.mockReset().mockResolvedValue(true);
  vi.unstubAllEnvs();
  vi.stubEnv("DEMO_CALL", "1");
});

describe("the demo call actions (owner, 13 Nov 2026)", () => {
  it("start and end go to C1's routes for the Owner of a demo workspace", async () => {
    expect(await startDemoCallAction(T)).toEqual({ ok: true });
    expect(h.start).toHaveBeenCalledWith("tok", T);
    expect(await endDemoCallAction(T)).toEqual({ ok: true });
    expect(h.end).toHaveBeenCalledWith("tok", T);
  });
  it.each([
    ["the flag is off", () => vi.stubEnv("DEMO_CALL", ""), T],
    ["not a workspace id", () => undefined, "nope"],
    ["not a demo workspace", () => h.demo.mockResolvedValue(false), T],
    ["a sales member", () => h.tenant.mockResolvedValue({ role: "sales", name: "x" }), T],
  ])("is refused before the API is asked when %s", async (_n, setup, id) => {
    setup();
    expect(await startDemoCallAction(id)).toEqual({ ok: false });
    expect(await endDemoCallAction(id)).toEqual({ ok: false });
    expect(h.start).not.toHaveBeenCalled();
    expect(h.end).not.toHaveBeenCalled();
  });
  it("an API refusal is {ok:false}, not a crash", async () => {
    h.start.mockRejectedValueOnce(new Error("404"));
    expect(await startDemoCallAction(T)).toEqual({ ok: false });
  });
});
