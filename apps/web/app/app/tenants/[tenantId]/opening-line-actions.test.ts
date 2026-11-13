import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchTenant = vi.fn();
const saveOpeningLine = vi.fn();
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`NEXT_REDIRECT:${to}`); } }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: "u", email: "e@example.test", accessToken: "tok" }) }));
vi.mock("@/lib/api/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => fetchTenant(...a) }));
vi.mock("@/lib/opening-line/source", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/opening-line/source")>()), saveOpeningLine: (...a: unknown[]) => saveOpeningLine(...a) }));

import { saveMentionAiAction } from "./opening-line-actions";

const T = "22222222-2222-4222-8222-222222222222";
beforeEach(() => {
  vi.clearAllMocks();
  fetchTenant.mockResolvedValue({ id: T, role: "owner" });
  saveOpeningLine.mockResolvedValue({ ok: true, data: {} });
});

describe("the AI-mention switch under the greeting (saveMentionAiAction)", () => {
  it("saves only the switch (no line text) as the Owner, then reads both pages again", async () => {
    expect(await saveMentionAiAction(T, false)).toEqual({ ok: true });
    expect(saveOpeningLine).toHaveBeenCalledWith({ token: "tok", tenantId: T }, { lines: {}, mentionAi: false });
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${T}/ai-team/training`);
  });

  it("anyone but the Owner is refused before the API is asked; a non-boolean is invalid", async () => {
    fetchTenant.mockResolvedValue({ id: T, role: "admin" });
    expect(await saveMentionAiAction(T, true)).toEqual({ ok: false, error: "forbidden" });
    expect(await saveMentionAiAction(T, "yes" as unknown as boolean)).toEqual({ ok: false, error: "invalid" });
    expect(saveOpeningLine).not.toHaveBeenCalled();
  });

  it("an API refusal comes back as a closed word", async () => {
    saveOpeningLine.mockResolvedValue({ ok: false, error: "read_only" });
    expect(await saveMentionAiAction(T, true)).toEqual({ ok: false, error: "read_only" });
  });
});
