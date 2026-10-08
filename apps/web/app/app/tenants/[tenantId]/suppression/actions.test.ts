import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { redirectMock, redirectTarget } from "@/test/helpers";

const requireUser = vi.fn();
const api = { runBackfill: vi.fn() };
const revalidatePath = vi.fn();

vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to) }));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/suppression", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/suppression")>()),
  runBackfill: (...a: unknown[]) => api.runBackfill(...a),
}));

import { backfillKeysAction } from "./actions";

const TENANT = "22222222-2222-2222-2222-222222222222";
const CANARY = "CANARY-5e1a77";
const DONE = { recorded: 3, skipped: 0, flagged: 0, unkeyable: 0, remaining: 0 };
const run = () => backfillKeysAction(TENANT);

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "u", email: "e", accessToken: "tok", aal: "aal2" });
  api.runBackfill.mockResolvedValue(DONE);
});

describe("backfillKeysAction", () => {
  it("authenticates first, calls the backfill with the user's token and the workspace only, and refreshes the page", async () => {
    const r = await run();
    expect(requireUser).toHaveBeenCalledTimes(1);
    expect(api.runBackfill).toHaveBeenCalledWith("tok", TENANT);
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${TENANT}/suppression`);
    expect(r).toEqual({ ok: true, recorded: 3, remaining: 0, unkeyable: 0 });
  });
  it("its answer is counts: even with nothing remaining it never claims that every contact is keyed (only the re-read status can)", async () => {
    const text = JSON.stringify(await run());
    expect(text).not.toMatch(/ready|clear|all contacts|every contact|keyed/i);
  });
  it("a partial run reports what is left", async () => {
    api.runBackfill.mockResolvedValue({ ...DONE, recorded: 100, unkeyable: 2, remaining: 130 });
    expect(await run()).toEqual({ ok: true, recorded: 100, remaining: 130, unkeyable: 2 });
  });
  it("a malformed workspace id never reaches the API", async () => {
    const r = await backfillKeysAction("x");
    expect(r).toEqual({ ok: false, error: "This workspace is not available." });
    expect(api.runBackfill).not.toHaveBeenCalled();
  });
  it("a rejected session goes to sign-in", async () => {
    api.runBackfill.mockRejectedValue(new ApiAuthError("no"));
    expect(await redirectTarget(run)).toBe("/login");
  });
  it.each([
    [new ApiRequestError(403, "mfa_required", CANARY), /authenticator app/],
    [new ApiRequestError(403, "forbidden", CANARY), /Only the owner can record suppression keys\./],
    [new ApiRequestError(404, "not_found", CANARY), /This workspace is not available\./],
    [new ApiRequestError(503, "suppression_key_not_configured", CANARY), /not available right now\. Nothing was changed\./],
    [new ApiRequestError(503, "suppression_unavailable", CANARY), /not available right now\. Nothing was changed\./],
    [new ApiRequestError(500, "http_error", CANARY), /Could not record the keys\. Try again\./],
    [new Error(CANARY), /Could not record the keys\. Try again\./],
  ])("%s becomes a short sentence of our own, and nothing the API said is echoed", async (error, sentence) => {
    api.runBackfill.mockRejectedValue(error);
    const r = await run();
    expect(r?.ok).toBe(false);
    expect(r?.error).toMatch(sentence);
    expect(JSON.stringify(r)).not.toContain(CANARY);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("pressing twice is two calls to an idempotent endpoint, each answered on its own", async () => {
    api.runBackfill.mockResolvedValueOnce({ ...DONE, recorded: 5, remaining: 2 }).mockResolvedValueOnce({ ...DONE, recorded: 2, remaining: 0 });
    expect((await run())?.remaining).toBe(2);
    expect((await run())?.remaining).toBe(0);
  });
});
