import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { redirectMock, redirectTarget } from "@/test/helpers";

const requireUser = vi.fn();
const setAgentsEnabled = vi.fn();
const startSelftestRun = vi.fn();
const cancelRun = vi.fn();
const revalidatePath = vi.fn();

vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to) }));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/agents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/agents")>()),
  setAgentsEnabled: (...a: unknown[]) => setAgentsEnabled(...a),
  startSelftestRun: (...a: unknown[]) => startSelftestRun(...a),
  cancelRun: (...a: unknown[]) => cancelRun(...a),
}));

import { cancelRunAction, startRunAction, toggleAgentsAction } from "./actions";

const TENANT = "22222222-2222-2222-2222-222222222222";
const COMPANY = "33333333-3333-3333-3333-333333333333";
const RUN = "44444444-4444-4444-4444-444444444444";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(values)) data.set(k, v);
  return data;
}

describe("agent actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUser.mockResolvedValue({ id: "u", email: "e", accessToken: "tok" });
    setAgentsEnabled.mockResolvedValue({ enabled: true });
    startSelftestRun.mockResolvedValue({});
    cancelRun.mockResolvedValue(undefined);
  });

  it("toggles the workspace switch and revalidates the page", async () => {
    expect((await toggleAgentsAction(TENANT, undefined, form({ enabled: "true" })))?.ok).toBe(true);
    expect(setAgentsEnabled).toHaveBeenCalledWith("tok", TENANT, true);
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${TENANT}/agents`);
    await toggleAgentsAction(TENANT, undefined, form({ enabled: "false" }));
    expect(setAgentsEnabled).toHaveBeenLastCalledWith("tok", TENANT, false);
    expect((await toggleAgentsAction(TENANT, undefined, form({ enabled: "maybe" })))?.ok).toBe(false);
    expect((await toggleAgentsAction("bad", undefined, form({ enabled: "true" })))?.ok).toBe(false);
  });

  it("starts a run with the id from the form (one per render) and the chosen company", async () => {
    const res = await startRunAction(TENANT, undefined, form({ run_id: RUN, company_id: COMPANY }));
    expect(res?.ok).toBe(true);
    expect(startSelftestRun).toHaveBeenCalledWith("tok", TENANT, { id: RUN, companyId: COMPANY });
  });

  it("refuses a missing run id or company without calling the API", async () => {
    expect((await startRunAction(TENANT, undefined, form({ company_id: COMPANY })))?.ok).toBe(false);
    expect((await startRunAction(TENANT, undefined, form({ run_id: RUN, company_id: "x" })))?.ok).toBe(false);
    expect(startSelftestRun).not.toHaveBeenCalled();
  });

  it("explains each refusal in a short fixed message, never the API's text", async () => {
    const cases: [number, string, RegExp][] = [
      [403, "forbidden", /role cannot start/],
      [404, "not_found", /not available/],
      [409, "agents_disabled", /not enabled/],
      [409, "token_expiring", /session/],
      [409, "conflict", /out of date/],
      [429, "run_limit_reached", /Too many/],
      [503, "agents_unavailable", /not available right now/],
      [500, "http_error", /Could not start/],
    ];
    for (const [status, code, message] of cases) {
      startSelftestRun.mockRejectedValueOnce(new ApiRequestError(status, code, "CANARY-body"));
      const res = await startRunAction(TENANT, undefined, form({ run_id: RUN, company_id: COMPANY }));
      expect(res?.ok).toBe(false);
      expect(res?.error).toMatch(message);
      expect(JSON.stringify(res)).not.toContain("CANARY");
    }
  });

  it("cancels a run", async () => {
    expect((await cancelRunAction(TENANT, RUN))?.ok).toBe(true);
    expect(cancelRun).toHaveBeenCalledWith("tok", TENANT, RUN);
    expect((await cancelRunAction(TENANT, "x"))?.ok).toBe(false);
  });

  it("sends an expired session to the login page", async () => {
    cancelRun.mockRejectedValueOnce(new ApiAuthError("expired"));
    expect(await redirectTarget(() => cancelRunAction(TENANT, RUN))).toBe("/login");
  });
});
