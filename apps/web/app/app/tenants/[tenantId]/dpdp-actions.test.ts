import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => ({ get: (n: string) => (n === "x-forwarded-for" ? "203.0.113.5" : null) }) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: "u", accessToken: "tok-1" }) }));
const changeMarketing = vi.fn();
const raiseGrievance = vi.fn();
vi.mock("@/lib/dpdp/source", async (orig) => ({ ...(await orig<typeof import("@/lib/dpdp/source")>()), changeMarketing: (...a: unknown[]) => changeMarketing(...a), raiseGrievance: (...a: unknown[]) => raiseGrievance(...a) }));
const allow = vi.fn(() => true);
vi.mock("@/lib/site/lead-limit", () => ({ sharedLeadLimiter: () => ({ allow }) }));

import { grievanceAction, setMarketingAction } from "./dpdp-actions";

const T = "22222222-2222-2222-2222-222222222222";
beforeEach(() => {
  vi.clearAllMocks();
  allow.mockReturnValue(true);
  changeMarketing.mockResolvedValue({ ok: true, consents: {} });
  raiseGrievance.mockResolvedValue({ ok: true, reference: "GR-2026-000001", answerDueOn: "2026-11-26", answerWithinDays: 30 });
  vi.stubEnv("DPDP_SCREENS", "1");
});
afterEach(() => vi.unstubAllEnvs());

describe("the marketing switch action", () => {
  it("gives or withdraws with the person's token, from Settings, and says nothing is allowed when the consent API is off", async () => {
    expect(await setMarketingAction(T, true)).toMatchObject({ ok: true });
    expect(changeMarketing).toHaveBeenCalledWith("tok-1", true, "settings");
    await setMarketingAction(T, false);
    expect(changeMarketing).toHaveBeenLastCalledWith("tok-1", false, "settings");
    vi.stubEnv("DPDP_SCREENS", "");
    expect(await setMarketingAction(T, true)).toEqual({ ok: false, error: "forbidden" });
  });
  it("only a real boolean counts: a string 'true' from a forged post is refused and changes nothing", async () => {
    expect(await setMarketingAction(T, "true" as never)).toEqual({ ok: false, error: "forbidden" });
    expect(changeMarketing).not.toHaveBeenCalled();
  });
});

describe("the grievance action", () => {
  const form = { name: "  Lakshmi  ", contact: "lakshmi@shop.example", kind: "erasure", details: "Please erase my number.", language: "hi" };
  it("checks every field, then sends a clean grievance", async () => {
    expect(await grievanceAction(T, form)).toMatchObject({ ok: true, reference: "GR-2026-000001" });
    expect(raiseGrievance).toHaveBeenCalledWith({ name: "Lakshmi", contact: "lakshmi@shop.example", kind: "erasure", details: "Please erase my number.", language: "hi" });
  });
  it("an unknown kind is 'other', an unknown language English, control characters are cut from the details, and the details are at most 4000 characters", async () => {
    await grievanceAction(T, { ...form, kind: "hack", language: "xx", details: `a\u0000b${"z".repeat(5000)}` });
    const sent = raiseGrievance.mock.calls[0][0];
    expect(sent.kind).toBe("other");
    expect(sent.language).toBe("en");
    expect(sent.details.startsWith("a b")).toBe(true);
    expect(sent.details.length).toBe(4000);
  });
  it("a missing name or contact is refused with the reason and nothing is sent or counted", async () => {
    expect(await grievanceAction(T, { ...form, name: " " })).toEqual({ ok: false, error: "name" });
    expect(await grievanceAction(T, { ...form, contact: "x" })).toEqual({ ok: false, error: "contact" });
    expect(await grievanceAction(T, null)).toEqual({ ok: false, error: "name" });
    expect(raiseGrievance).not.toHaveBeenCalled();
    expect(allow).not.toHaveBeenCalled();
  });
  it("too many tries from one address is 'rate'; the consent API off is 'down'", async () => {
    allow.mockReturnValue(false);
    expect(await grievanceAction(T, form)).toEqual({ ok: false, error: "rate" });
    allow.mockReturnValue(true);
    vi.stubEnv("DPDP_SCREENS", "");
    expect(await grievanceAction(T, form)).toEqual({ ok: false, error: "down" });
  });
});
