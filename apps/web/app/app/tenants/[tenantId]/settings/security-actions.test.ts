import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, redirectMock, redirectTarget } from "@/test/helpers";

const createClient = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to) }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: () => createClient() }));

import { signOutEverywhereAction } from "./security-actions";

beforeEach(() => vi.clearAllMocks());

describe("Settings > Security: sign out of all devices", () => {
  it("ends every session (global scope, not only this browser) and sends the person to sign in with a note", async () => {
    const signOut = vi.fn(async () => ({ error: null }));
    createClient.mockResolvedValue(fakeSupabase({ signOut }));
    expect(await redirectTarget(() => signOutEverywhereAction())).toBe("/login?notice=everywhere");
    expect(signOut).toHaveBeenCalledWith({ scope: "global" });
  });
  it("when it fails the person stays on the page, still signed in, and is told", async () => {
    createClient.mockResolvedValue(fakeSupabase({ signOut: vi.fn(async () => ({ error: { message: "x" } })) }));
    expect(await redirectTarget(() => signOutEverywhereAction())).toBe("?section=security&signout=failed");
  });
});
