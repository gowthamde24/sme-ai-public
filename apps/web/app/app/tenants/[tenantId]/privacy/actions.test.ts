import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "@/lib/api/client";
import { redirectMock } from "@/test/helpers";

const requireUser = vi.fn();
const requestErasure = vi.fn();
const executeErasure = vi.fn();
const cancelErasure = vi.fn();
const revalidatePath = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (to: string) => redirectMock(to),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => revalidatePath(p),
}));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/erasure", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/erasure")>()),
  requestErasure: (...a: unknown[]) => requestErasure(...a),
  executeErasure: (...a: unknown[]) => executeErasure(...a),
  cancelErasure: (...a: unknown[]) => cancelErasure(...a),
}));

import {
  cancelErasureAction,
  executeErasureAction,
  previewErasureAction,
  requestErasureAction,
} from "./actions";

const TENANT = "22222222-2222-2222-2222-222222222222";
const REQ = "44444444-4444-4444-4444-444444444444";
const CONTACT = "33333333-3333-3333-3333-333333333333";
const COMPANY = "66666666-6666-4666-8666-666666666666";
const RESULT = {
  request_id: REQ,
  scope: "contact",
  status: "executed",
  dry_run: false,
  counts: {},
  review: [],
  review_truncated: false,
  exports_logged: 0,
  note: "n",
  replayed: false,
};

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(values)) data.set(k, v);
  return data;
}

describe("privacy actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUser.mockResolvedValue({ id: "u", email: "e", accessToken: "tok" });
    requestErasure.mockResolvedValue({});
    executeErasure.mockResolvedValue(RESULT);
    cancelErasure.mockResolvedValue({});
  });

  it("requests one contact, one company or the workspace, with the id from the form", async () => {
    expect(
      (
        await requestErasureAction(
          TENANT,
          undefined,
          form({ request_id: REQ, scope: "contact", contact_id: CONTACT }),
        )
      )?.ok,
    ).toBe(true);
    expect(requestErasure).toHaveBeenLastCalledWith("tok", TENANT, {
      id: REQ,
      scope: "contact",
      subjectId: CONTACT,
    });
    await requestErasureAction(
      TENANT,
      undefined,
      form({
        request_id: REQ,
        scope: "company",
        company_id: COMPANY,
        contact_id: CONTACT,
      }),
    );
    expect(requestErasure).toHaveBeenLastCalledWith("tok", TENANT, {
      id: REQ,
      scope: "company",
      subjectId: COMPANY,
    });
    const tenantWide = await requestErasureAction(
      TENANT,
      undefined,
      form({ request_id: REQ, scope: "tenant", contact_id: CONTACT }),
    );
    expect(requestErasure).toHaveBeenLastCalledWith("tok", TENANT, {
      id: REQ,
      scope: "tenant",
      subjectId: null,
    });
    expect(tenantWide?.message).toMatch(/24 hours/);
    expect(revalidatePath).toHaveBeenCalledWith(
      `/app/tenants/${TENANT}/privacy`,
    );
  });

  it("refuses a missing request id, scope or subject without calling the API", async () => {
    const bad: Record<string, string>[] = [
      { scope: "contact", contact_id: CONTACT },
      { request_id: REQ, scope: "everything", contact_id: CONTACT },
      { request_id: REQ, scope: "contact" },
      { request_id: REQ, scope: "contact", contact_id: "x" },
      { request_id: REQ, scope: "company", contact_id: CONTACT },
    ];
    for (const values of bad)
      expect(
        (await requestErasureAction(TENANT, undefined, form(values)))?.ok,
      ).toBe(false);
    expect(
      (
        await requestErasureAction(
          "bad",
          undefined,
          form({ request_id: REQ, scope: "tenant" }),
        )
      )?.ok,
    ).toBe(false);
    expect(requestErasure).not.toHaveBeenCalled();
  });

  it("previews without the confirmation and revalidates nothing", async () => {
    const res = await previewErasureAction(TENANT, REQ);
    expect(res?.ok).toBe(true);
    expect(executeErasure).toHaveBeenCalledWith("tok", TENANT, REQ, true);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("will not erase until the box is ticked", async () => {
    expect(
      (await executeErasureAction(TENANT, REQ, undefined, form({})))?.ok,
    ).toBe(false);
    expect(
      (
        await executeErasureAction(
          TENANT,
          REQ,
          undefined,
          form({ confirm: "no" }),
        )
      )?.ok,
    ).toBe(false);
    expect(executeErasure).not.toHaveBeenCalled();
    const done = await executeErasureAction(
      TENANT,
      REQ,
      undefined,
      form({ confirm: "yes" }),
    );
    expect(done?.ok).toBe(true);
    expect(executeErasure).toHaveBeenCalledWith("tok", TENANT, REQ, false);
    expect(revalidatePath).toHaveBeenCalled();
  });

  it("cancels a request, and refuses malformed ids", async () => {
    expect((await cancelErasureAction(TENANT, REQ))?.ok).toBe(true);
    expect(cancelErasure).toHaveBeenCalledWith("tok", TENANT, REQ);
    expect((await cancelErasureAction(TENANT, "x"))?.ok).toBe(false);
    expect((await previewErasureAction("x", REQ))?.ok).toBe(false);
  });

  it("explains each refusal in a short fixed message, never the API's text", async () => {
    const cases: [number, string, RegExp][] = [
      [403, "forbidden", /role cannot run/],
      [404, "not_found", /not available/],
      [409, "erasure_window_open", /24 hours/],
      [409, "erasure_cancelled", /cancelled/],
      [409, "erasure_already_executed", /already been carried out/],
      [409, "erasure_not_pending", /no longer waiting/],
      [409, "conflict", /out of date/],
      [503, "erasure_unavailable", /not available right now/],
      [500, "http_error", /Could not run/],
    ];
    for (const [status, code, message] of cases) {
      executeErasure.mockRejectedValueOnce(
        new ApiRequestError(status, code, "CANARY-body"),
      );
      const res = await executeErasureAction(
        TENANT,
        REQ,
        undefined,
        form({ confirm: "yes" }),
      );
      expect(res?.ok).toBe(false);
      expect(res?.error).toMatch(message);
      expect(JSON.stringify(res)).not.toContain("CANARY");
    }
  });
});
