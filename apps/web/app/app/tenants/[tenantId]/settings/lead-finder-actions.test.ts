import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { T } from "@/lib/api/lead-finder-fixtures";

const h = vi.hoisted(() => ({ tenant: vi.fn(), save: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`NEXT_REDIRECT:${to}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: "u", email: "e@example.test", accessToken: "tok" }) }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => h.tenant(...a) }));
vi.mock("@/lib/api/lead-finder", async (orig) => ({ ...(await orig<typeof import("@/lib/api/lead-finder")>()), saveFinderSettings: (...a: unknown[]) => h.save(...a) }));

import { saveFinderSettingsAction } from "./lead-finder-actions";

const as = (role: string) => h.tenant.mockResolvedValue({ id: T, name: "Acme Silks", slug: "acme-silks", role });
beforeEach(() => {
  h.tenant.mockReset();
  h.save.mockReset().mockResolvedValue({ fitBar: 75 });
  as("owner");
});

describe("saving Settings > Lead Finder", () => {
  it.each(["owner", "admin"])("%s saves the subset with the person's token", async (role) => {
    as(role);
    expect(await saveFinderSettingsAction(T, { fitBar: 75 })).toEqual({ ok: true, data: { fitBar: 75 } });
    expect(h.save).toHaveBeenCalledWith("tok", T, { fitBar: 75 });
  });
  it.each(["sales", "viewer"])("%s may not (the API is not asked)", async (role) => {
    as(role);
    expect(await saveFinderSettingsAction(T, { fitBar: 75 })).toMatchObject({ ok: false, kind: "forbidden" });
    expect(h.save).not.toHaveBeenCalled();
  });
  it.each([[{}], [{ fitBar: 49 }], [{ dailyCallCap: 501 }], [{ callFromHour: 8 }], [{ callToHour: 22 }], [{ searchesPerDay: 21 }], [{ resultsPerSearch: 0 }], [{ fitBar: 70.5 }], [{ colour: 3 }]])("refuses %j before asking", async (changes) => {
    expect(await saveFinderSettingsAction(T, changes as never)).toMatchObject({ ok: false, kind: "invalid" });
    expect(h.save).not.toHaveBeenCalled();
  });
  it("the API's refusal of the hours is said in words; a rejected session goes to sign in", async () => {
    h.save.mockRejectedValueOnce(new ApiRequestError(422, "invalid_hours", "x"));
    expect(await saveFinderSettingsAction(T, { callFromHour: 12 })).toMatchObject({ ok: false, kind: "invalid", error: "The calling hours must start before they end." });
    // one hour sent that crosses the stored other: the API's validation_error with no field (#298) says the same
    h.save.mockRejectedValueOnce(new ApiRequestError(422, "validation_error", "x"));
    expect(await saveFinderSettingsAction(T, { callToHour: 10 })).toMatchObject({ ok: false, error: "The calling hours must start before they end." });
    // a validation_error on a save without an hour is not about the hours
    h.save.mockRejectedValueOnce(new ApiRequestError(422, "validation_error", "x"));
    expect(await saveFinderSettingsAction(T, { fitBar: 80 })).not.toMatchObject({ error: "The calling hours must start before they end." });
    h.save.mockRejectedValueOnce(new ApiAuthError("x"));
    await expect(saveFinderSettingsAction(T, { callFromHour: 12 })).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});
