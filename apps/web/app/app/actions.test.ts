import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { redirectMock, redirectTarget } from "@/test/helpers";

const createTenant = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (to: string) => redirectMock(to),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => ({ id: "u", accessToken: "token-1" }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  createTenant: (...a: unknown[]) => createTenant(...a),
}));

import { createTenantAction } from "./actions";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}
const OK = { name: "Acme Silks", slug: "acme-silks" };

describe("createTenantAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates the workspace with the caller's own token and goes to /app", async () => {
    createTenant.mockResolvedValue({});
    expect(await redirectTarget(() => createTenantAction(undefined, form(OK)))).toBe("/app");
    expect(createTenant).toHaveBeenCalledWith("token-1", "Acme Silks", "acme-silks");
  });

  it("checks the name and the URL name before calling the API", async () => {
    expect(await createTenantAction(undefined, form({ ...OK, name: "" }))).toEqual({
      error: "Enter a name (up to 120 characters).",
    });
    expect((await createTenantAction(undefined, form({ ...OK, slug: "No Good" })))?.error).toMatch(/URL name must be/);
    expect(createTenant).not.toHaveBeenCalled();
  });

  it("says plainly that the plan's one workspace is used up (409 workspace_limit_reached)", async () => {
    const sentence = "Your plan includes one workspace and you already have it. Ask us if you need another.";
    createTenant.mockRejectedValue(new ApiRequestError(409, "workspace_limit_reached", sentence));
    expect(await createTenantAction(undefined, form(OK))).toEqual({ error: sentence });
  });

  it("keeps saying the URL name is taken for any other 409", async () => {
    createTenant.mockRejectedValue(new ApiRequestError(409, "slug_unavailable", "That slug is not available."));
    expect(await createTenantAction(undefined, form(OK))).toEqual({ error: "That URL name is not available." });
  });

  it("sends a rejected session back to /login and shows a generic line for anything else", async () => {
    createTenant.mockRejectedValueOnce(new ApiAuthError("no"));
    expect(await redirectTarget(() => createTenantAction(undefined, form(OK)))).toBe("/login");
    createTenant.mockRejectedValueOnce(new ApiRequestError(502, "upstream_error", "x"));
    expect(await createTenantAction(undefined, form(OK))).toEqual({ error: "Could not create the workspace. Try again." });
  });
});
