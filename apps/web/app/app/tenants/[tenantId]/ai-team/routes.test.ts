import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const T = "11111111-1111-4111-8111-111111111111";
const h = vi.hoisted(() => ({ user: null as null | { accessToken: string }, role: "owner", jar: new Map<string, string>(), put: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => {
    if (!h.user) throw new Error("NEXT_REDIRECT:/login");
    return h.user;
  },
}));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: async () => ({ role: h.role }) }));
vi.mock("@/lib/packs/read", () => ({ readPackCached: async () => ({ modules: ["orders"] }) }));
vi.mock("@/i18n/get-lang", () => ({ getLang: async () => "te" }));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => h.revalidate(...a) }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (k: string) => (h.jar.has(k) ? { value: h.jar.get(k) } : undefined), set: (k: string, v: string) => void h.jar.set(k, v) }),
}));
vi.mock("@/lib/api/ai-team", async (orig) => ({ ...(await orig<typeof import("@/lib/api/ai-team")>()), putHelperSwitch: (...a: unknown[]) => h.put(...a) }));

import { ApiRequestError } from "@/lib/api/client";

import { remakeStandupAction, switchHelperAction } from "./actions";
import { dayOrToday } from "./ai-team-data";
import { GET as day } from "./day/route";
import { GET as panel } from "./panel/route";
import { GET as audio } from "./standup-audio/route";

const HOST = "app.example.test";
const req = (path: string, site = "same-origin") => new NextRequest(`https://${HOST}/app/tenants/${T}/ai-team/${path}`, { headers: { "sec-fetch-site": site, host: HOST } });
const params = { params: Promise.resolve({ tenantId: T }) };

beforeEach(() => {
  h.user = { accessToken: "tok" };
  h.role = "owner";
  h.jar.clear();
  h.put.mockReset();
  vi.stubEnv("AI_TEAM_SCREENS", "mock");
});
afterEach(() => vi.unstubAllEnvs());

describe("My AI team v2's routes and actions", () => {
  it("off unless AI_TEAM_SCREENS is set; same-site only; no session is 401", async () => {
    vi.stubEnv("AI_TEAM_SCREENS", "");
    expect((await day(req("day"), params)).status).toBe(404);
    vi.stubEnv("AI_TEAM_SCREENS", "mock");
    expect((await day(req("day", "cross-site"), params)).status).toBe(403);
    h.user = null;
    expect((await day(req("day"), params)).status).toBe(401);
  });
  it("the day (mock: the made-up day through the real parser); Sales gets no cost", async () => {
    const r = await day(req("day"), params);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const body = (await r.json()) as { day: { lanes: unknown[]; costToday: unknown } };
    expect(body.day.lanes).toHaveLength(6);
    expect(body.day.costToday).not.toBeNull();
    h.role = "sales";
    expect(((await (await day(req("day"), params)).json()) as { day: { costToday: unknown } }).day.costToday).toBeNull();
  });
  it("a helper's panel; an unknown or absent helper is 404", async () => {
    const own = (await (await panel(req("panel?helper=caller"), params)).json()) as { panel: { canSwitch: boolean; costToday: unknown } };
    expect(own.panel.canSwitch).toBe(true);
    expect(own.panel.costToday).not.toBeNull();
    h.role = "sales";
    expect(((await (await panel(req("panel?helper=caller"), params)).json()) as { panel: { canSwitch: boolean } }).panel.canSwitch).toBe(false);
    h.role = "owner";
    expect((await panel(req("panel?helper=boss"), params)).status).toBe(404);
    expect((await panel(req("panel?helper=admissions"), params)).status).toBe(404);
  });
  it("the stand-up's sound is a WAV, never cached", async () => {
    const r = await audio(req("standup-audio"), params);
    expect(r.headers.get("content-type")).toBe("audio/wav");
    expect(r.headers.get("cache-control")).toContain("no-store");
  });
  it("the switch: Owner or Admin only; off then on in mock mode (a cookie), the day shows it paused", async () => {
    expect(await switchHelperAction(T, "caller", false)).toEqual({ ok: true, enabled: false });
    const d = (await (await day(req("day"), params)).json()) as { day: { lanes: { helper: string; enabled: boolean; statusNow: { kind: string } }[] } };
    expect(d.day.lanes.find((l) => l.helper === "caller")).toMatchObject({ enabled: false, statusNow: { kind: "paused" } });
    expect(await switchHelperAction(T, "caller", true)).toEqual({ ok: true, enabled: true });
    h.role = "sales";
    expect(await switchHelperAction(T, "caller", false)).toEqual({ ok: false, error: "forbidden" });
    expect(await switchHelperAction(T, "boss", false)).toEqual({ ok: false, error: "failed" });
  });
  it("the switch with the API: 403 mfa_required asks for the second factor", async () => {
    vi.stubEnv("AI_TEAM_SCREENS", "1");
    h.put.mockRejectedValue(new ApiRequestError(403, "mfa_required", "second factor"));
    expect(await switchHelperAction(T, "caller", false)).toEqual({ ok: false, error: "mfa" });
    expect(h.put).toHaveBeenCalledWith("tok", T, "caller", false);
  });
  it("Make it again: at most 3 a day, then the limit", async () => {
    const date = dayOrToday(null);
    for (let i = 0; i < 3; i++) expect((await remakeStandupAction(T, date)).ok).toBe(true);
    expect(await remakeStandupAction(T, date)).toEqual({ ok: false, error: "limit" });
    h.role = "sales";
    expect(await remakeStandupAction(T, date)).toEqual({ ok: false, error: "forbidden" });
  });
  it("a day is today or up to 31 days back; anything else is today", () => {
    const now = new Date("2026-11-06T08:00:00Z");
    expect(dayOrToday("2026-11-05", now)).toBe("2026-11-05");
    expect(dayOrToday("2026-10-06", now)).toBe("2026-10-06");
    expect(dayOrToday("2026-10-05", now)).toBe("2026-11-06");
    expect(dayOrToday("2026-11-07", now)).toBe("2026-11-06");
    expect(dayOrToday("nope", now)).toBe("2026-11-06");
  });
});
