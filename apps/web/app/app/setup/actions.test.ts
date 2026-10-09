import { beforeEach, describe, expect, it, vi } from "vitest";

const submitAccountSetup = vi.fn();
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: "u", accessToken: "token-9" }) }));
vi.mock("@/lib/api/account", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/account")>()),
  submitAccountSetup: (...a: unknown[]) => submitAccountSetup(...a),
}));

import { completeSetup } from "./actions";

describe("the completeSetup action", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses the signed-in person's own token and refreshes /app on success", async () => {
    submitAccountSetup.mockResolvedValue({ tenantId: "t", created: true });
    expect(await completeSetup({ businessType: "textiles", language: "hi" })).toEqual({ ok: true });
    expect(submitAccountSetup).toHaveBeenCalledWith("token-9", { businessType: "textiles", language: "hi" });
    expect(revalidatePath).toHaveBeenCalledWith("/app");
  });

  it("does not refresh anything when it fails", async () => {
    expect(await completeSetup({ businessType: "bad" as never, language: "en" })).toMatchObject({ ok: false });
    expect(submitAccountSetup).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
