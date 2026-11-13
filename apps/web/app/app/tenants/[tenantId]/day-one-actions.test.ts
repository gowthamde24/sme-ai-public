import { beforeEach, describe, expect, it, vi } from "vitest";

const revalidatePath = vi.fn();
const redirectMock = vi.fn((to: string) => {
  throw new Error(`NEXT_REDIRECT:${to}`);
});
const fetchTenant = vi.fn();
const request = vi.fn();
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k) } : undefined), set: (k: string, v: string, o?: { maxAge?: number }) => (o?.maxAge === 0 ? jar.delete(k) : jar.set(k, v)) }) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: "u", email: "e@example.test", accessToken: "tok" }) }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => fetchTenant(...a), apiRequest: (...a: unknown[]) => request(...a) }));

import { ApiAuthError } from "@/lib/api/client";
import { CHOICE_COOKIE } from "@/lib/assistant-status/setup-choice";
import { PHONE_COOKIE } from "@/lib/assistant-status/go-live";
import { COOKIE } from "@/lib/assistant-status/source";

import { dismissChipAction, goLiveAction, skipSetupAction, testNumberAction } from "./day-one-actions";

const T = "22222222-2222-4222-8222-222222222222";
const tenant = (role: string, name = "Sri Lakshmi Silks") => fetchTenant.mockResolvedValue({ id: T, name, role });

beforeEach(() => {
  vi.clearAllMocks();
  jar.clear();
  vi.unstubAllEnvs();
  vi.stubEnv("DESIGN_V6", "1");
  vi.stubEnv("ASSISTANT_STATUS", "mock");
});

describe("the day-one actions (design system v6)", () => {
  it("'Skip for now' and the chip's cross only write the person's choice, for the Owner and Admin", async () => {
    tenant("owner");
    await skipSetupAction(T);
    expect(JSON.parse(jar.get(CHOICE_COOKIE) ?? "{}")).toEqual({ [T]: "skipped" });
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${T}`);
    await dismissChipAction(T);
    expect(JSON.parse(jar.get(CHOICE_COOKIE) ?? "{}")).toEqual({ [T]: "dismissed" });
    jar.clear();
    tenant("sales");
    await skipSetupAction(T);
    await dismissChipAction(T);
    expect(jar.has(CHOICE_COOKIE)).toBe(false);
  });

  it("does nothing where DESIGN_V6 is off, or for an id that is not a workspace", async () => {
    tenant("owner");
    vi.stubEnv("DESIGN_V6", "");
    await skipSetupAction(T);
    expect(jar.has(CHOICE_COOKIE)).toBe(false);
    vi.stubEnv("DESIGN_V6", "1");
    await skipSetupAction("nope");
    expect(jar.has(CHOICE_COOKIE)).toBe(false);
  });

  it("Go live is the Owner's: an Admin is refused; without a phone number it says what is missing; with it, it goes live", async () => {
    tenant("admin");
    expect(await goLiveAction(T)).toEqual({ ok: false, missing: [] });
    tenant("owner");
    expect(await goLiveAction(T)).toEqual({ ok: false, missing: ["phone_number"] });
    expect(jar.has(COOKIE)).toBe(false);
    await testNumberAction(T);
    expect(jar.has(PHONE_COOKIE)).toBe(true);
    expect(await goLiveAction(T)).toEqual({ ok: true, missing: [] });
    expect(jar.get(COOKIE)).toBe("live");
  });

  it("the business name counts only when it is a name of its own", async () => {
    tenant("owner", "My business");
    await testNumberAction(T);
    expect(await goLiveAction(T)).toEqual({ ok: false, missing: ["business_name"] });
  });

  it("the test number is staging only (mock) and for the people who set up", async () => {
    tenant("sales");
    await testNumberAction(T);
    expect(jar.has(PHONE_COOKIE)).toBe(false);
    tenant("owner");
    vi.stubEnv("ASSISTANT_STATUS", "1");
    await testNumberAction(T);
    expect(jar.has(PHONE_COOKIE)).toBe(false);
  });

  it("a lapsed sign-in goes to the sign-in page", async () => {
    fetchTenant.mockRejectedValue(new ApiAuthError());
    await expect(skipSetupAction(T)).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});
