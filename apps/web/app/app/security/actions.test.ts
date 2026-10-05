import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, redirectMock, redirectTarget } from "@/test/helpers";

const requireUser = vi.fn();
const createClient = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: () => createClient() }));

import { safeQr } from "@/lib/auth/qr";

import { finishEnrolment, removeAuthenticator, startEnrolment } from "./actions";

const FACTOR = "11111111-2222-3333-4444-555555555555";
function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(values)) data.set(k, v);
  return data;
}
const user = (hasSecondFactor: boolean) => ({ id: "u", email: "o@example.test", accessToken: "t", aal: hasSecondFactor ? "aal2" : "aal1", hasSecondFactor });
const mfa = (over: Record<string, unknown> = {}) => ({ ...fakeSupabase().auth.mfa, ...over });

describe("startEnrolment", () => {
  beforeEach(() => vi.clearAllMocks());

  it("enrols a TOTP factor, removes unfinished ones first, and returns only the QR image, the key and the id", async () => {
    requireUser.mockResolvedValue(user(false));
    const unenroll = vi.fn(async () => ({ data: {}, error: null }));
    const enroll = vi.fn(async () => ({ data: { id: FACTOR, totp: { qr_code: "data:image/svg+xml;utf-8,<svg/>", secret: "JBSWY3DPEHPK3PXP", uri: "otpauth://x" } }, error: null }));
    createClient.mockResolvedValue(fakeSupabase({ mfa: mfa({ enroll, unenroll, listFactors: vi.fn(async () => ({ data: { all: [{ id: "old", status: "unverified" }, { id: "keep", status: "verified" }] }, error: null })) }) }));
    expect(await startEnrolment()).toEqual({ factorId: FACTOR, qr: "data:image/svg+xml;utf-8,<svg/>", secret: "JBSWY3DPEHPK3PXP" });
    expect(unenroll).toHaveBeenCalledTimes(1);
    expect(unenroll).toHaveBeenCalledWith({ factorId: "old" });
  });

  it("refuses to start when an authenticator already exists", async () => {
    requireUser.mockResolvedValue(user(true));
    const supabase = fakeSupabase();
    createClient.mockResolvedValue(supabase);
    expect((await startEnrolment())?.error).toMatch(/already/);
    expect(supabase.auth.mfa.enroll).not.toHaveBeenCalled();
  });

  it("a failure is a fixed message", async () => {
    requireUser.mockResolvedValue(user(false));
    createClient.mockResolvedValue(fakeSupabase({ mfa: mfa({ enroll: vi.fn(async () => ({ data: null, error: { message: "CANARY" } })) }) }));
    const result = await startEnrolment();
    expect(result?.error).toMatch(/Could not start/);
    expect(JSON.stringify(result)).not.toContain("CANARY");
  });
});

describe("safeQr", () => {
  it("only an SVG data URI is ever put in an image", () => {
    expect(safeQr("data:image/svg+xml;utf-8,<svg/>")).toBe("data:image/svg+xml;utf-8,<svg/>");
    for (const bad of ["javascript:alert(1)", "https://evil.example/x.svg", "data:text/html,<script>", "", null, undefined, 5]) expect(safeQr(bad)).toBeNull();
  });
});

describe("finishEnrolment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUser.mockResolvedValue(user(false));
  });

  it("proves the app works with a code, then returns to the page", async () => {
    const supabase = fakeSupabase();
    createClient.mockResolvedValue(supabase);
    expect(await redirectTarget(() => finishEnrolment(undefined, form({ code: "123 456", factor_id: FACTOR })))).toBe("/app/security?done=1");
    expect(supabase.auth.mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: FACTOR, code: "123456" });
  });

  it.each([[{ code: "12345", factor_id: FACTOR }, /six digits/], [{ code: "123456", factor_id: "not-a-uuid" }, /out of date/], [{ code: "123456" }, /out of date/]])(
    "refuses a malformed submission %j without asking the Auth server",
    async (values, pattern) => {
      const supabase = fakeSupabase();
      createClient.mockResolvedValue(supabase);
      expect((await finishEnrolment(undefined, form(values as Record<string, string>)))?.error).toMatch(pattern);
      expect(supabase.auth.mfa.challengeAndVerify).not.toHaveBeenCalled();
    },
  );

  it("a wrong code is one fixed message", async () => {
    createClient.mockResolvedValue(fakeSupabase({ mfa: mfa({ challengeAndVerify: vi.fn(async () => ({ data: null, error: { message: "CANARY" } })) }) }));
    const result = await finishEnrolment(undefined, form({ code: "000000", factor_id: FACTOR }));
    expect(result?.error).toMatch(/did not work/);
    expect(JSON.stringify(result)).not.toContain("CANARY");
  });
});

describe("removeAuthenticator", () => {
  const supabaseWith = (over: Record<string, unknown> = {}) =>
    fakeSupabase({ mfa: mfa({ listFactors: vi.fn(async () => ({ data: { all: [], totp: [{ id: "f1" }] }, error: null })), ...over }) });

  beforeEach(() => {
    vi.clearAllMocks();
    requireUser.mockResolvedValue(user(true));
  });

  it("needs a FRESH code, verified BEFORE the factor is removed", async () => {
    const supabase = supabaseWith();
    createClient.mockResolvedValue(supabase);
    expect(await redirectTarget(() => removeAuthenticator(undefined, form({ code: "123456" })))).toBe("/app/security?removed=1");
    expect(supabase.auth.mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: "f1", code: "123456" });
    expect(supabase.auth.mfa.unenroll).toHaveBeenCalledWith({ factorId: "f1" });
    expect(supabase.auth.mfa.challengeAndVerify.mock.invocationCallOrder[0]).toBeLessThan(supabase.auth.mfa.unenroll.mock.invocationCallOrder[0]);
  });

  it("a wrong code removes nothing", async () => {
    const supabase = supabaseWith({ challengeAndVerify: vi.fn(async () => ({ data: null, error: { message: "x" } })) });
    createClient.mockResolvedValue(supabase);
    expect((await removeAuthenticator(undefined, form({ code: "000000" })))?.error).toMatch(/did not work/);
    expect(supabase.auth.mfa.unenroll).not.toHaveBeenCalled();
  });

  it("no code removes nothing", async () => {
    const supabase = supabaseWith();
    createClient.mockResolvedValue(supabase);
    expect((await removeAuthenticator(undefined, form({})))?.error).toMatch(/six digits/);
    expect(supabase.auth.mfa.challengeAndVerify).not.toHaveBeenCalled();
    expect(supabase.auth.mfa.unenroll).not.toHaveBeenCalled();
  });

  it("a person with no authenticator has nothing to remove", async () => {
    requireUser.mockResolvedValue(user(false));
    createClient.mockResolvedValue(supabaseWith());
    expect(await redirectTarget(() => removeAuthenticator(undefined, form({ code: "123456" })))).toBe("/app/security");
  });
});
