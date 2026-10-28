import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ tenant: vi.fn(), run: vi.fn(async (..._a: unknown[]) => ({ ok: true, lines: [], sound: null, leadId: null, note: null })) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ accessToken: "tok" }) }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => h.tenant(...a) }));
vi.mock("@/lib/guided-demo/events", () => ({ runDemoStep: (...a: unknown[]) => h.run(...a) }));
vi.mock("@/i18n/get-lang", () => ({ getLang: async () => "en" }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect ${to}`); } }));

import { runDemoStepAction } from "./guided-demo-actions";

const T = "22222222-2222-4222-8222-222222222222";
const L = "33333333-3333-4333-8333-333333333333";
beforeEach(() => {
  h.tenant.mockReset().mockResolvedValue({ role: "owner", name: "DEMO Silks (synthetic)" });
  h.run.mockClear();
  vi.unstubAllEnvs();
  vi.stubEnv("GUIDED_DEMO", "1");
});

describe("runDemoStepAction", () => {
  it("runs one step for the Owner of a DEMO workspace, with the question in the person's language", async () => {
    expect(await runDemoStepAction(T, "lead", "abcd1234-run", null)).toMatchObject({ ok: true });
    expect(h.run).toHaveBeenCalledWith({ token: "tok", tenantId: T }, "lead", { run: "abcd1234-run", leadId: null, question: expect.stringContaining("price") });
  });
  it.each([
    ["the flag is off", () => vi.stubEnv("GUIDED_DEMO", ""), T, "lead", "abcd1234-run", null],
    ["a step that is not in the story", () => undefined, T, "delete_all", "abcd1234-run", null],
    ["a run id that is not a plain id", () => undefined, T, "lead", "../x", null],
    ["a lead id that is not a uuid", () => undefined, T, "visit", "abcd1234-run", "nope"],
    ["a workspace id that is not a uuid", () => undefined, "x", "lead", "abcd1234-run", null],
  ])("refuses %s before the API is asked", async (_w, setup, t, key, run, lead) => {
    setup();
    expect(await runDemoStepAction(t, key, run, lead)).toEqual({ ok: false });
    expect(h.run).not.toHaveBeenCalled();
  });
  it("refuses a workspace that is not a DEMO one and a person who is not Owner or Admin", async () => {
    h.tenant.mockResolvedValue({ role: "owner", name: "Lakshmi Silks" });
    expect(await runDemoStepAction(T, "lead", "abcd1234-run", null)).toEqual({ ok: false });
    h.tenant.mockResolvedValue({ role: "sales", name: "DEMO Silks (synthetic)" });
    expect(await runDemoStepAction(T, "lead", "abcd1234-run", L)).toEqual({ ok: false });
    expect(h.run).not.toHaveBeenCalled();
  });
});
