import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, redirectMock, redirectTarget } from "@/test/helpers";

const requireUser = vi.fn();
const createClient = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: () => createClient() }));

import { setPassword } from "./actions";

const GOOD = "maple river lantern 42";
function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(values)) data.set(k, v);
  return data;
}

describe("setPassword", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUser.mockResolvedValue({ id: "u", email: "priya@example.test", accessToken: "t", aal: "aal1", hasSecondFactor: false });
  });

  it("needs a session first (no session: the gate redirects before anything is read)", async () => {
    requireUser.mockImplementation(() => redirectMock("/login"));
    createClient.mockResolvedValue(fakeSupabase());
    expect(await redirectTarget(() => setPassword(undefined, form({ password: GOOD, confirm: GOOD })))).toBe("/login");
    expect(createClient).not.toHaveBeenCalled();
  });

  it("enforces the policy on the server and does not call the Auth server for a bad password", async () => {
    const supabase = fakeSupabase();
    createClient.mockResolvedValue(supabase);
    for (const [password, confirm, pattern] of [
      ["short", "short", /at least 12/],
      [GOOD, GOOD + "x", /not the same/],
      ["priya-priya-priya-1", "priya-priya-priya-1", /email name/],
    ] as const) {
      expect((await setPassword(undefined, form({ password, confirm })))?.error).toMatch(pattern);
    }
    expect(supabase.auth.updateUser).not.toHaveBeenCalled();
  });

  it("sets the password, ends the person's OTHER sessions, and goes to the app", async () => {
    const supabase = fakeSupabase();
    createClient.mockResolvedValue(supabase);
    expect(await redirectTarget(() => setPassword(undefined, form({ password: GOOD, confirm: GOOD })))).toBe("/app");
    expect(supabase.auth.updateUser).toHaveBeenCalledWith({ password: GOOD });
    expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: "others" });
  });

  it.each([
    ["weak_password", /too easy to guess/],
    ["same_password", /not used before/],
    ["session_expired", /request a new one/],
  ])("explains %s in a fixed message", async (code, pattern) => {
    createClient.mockResolvedValue(fakeSupabase({ updateUser: vi.fn(async () => ({ data: {}, error: { code, message: "CANARY words from the server" } })) }));
    const result = await setPassword(undefined, form({ password: GOOD, confirm: GOOD }));
    expect(result?.error).toMatch(pattern);
    expect(JSON.stringify(result)).not.toContain("CANARY");
    expect(JSON.stringify(result)).not.toContain(GOOD);
  });
});
