import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";

const T = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";
const h = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`NEXT_REDIRECT:${to}`); } }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: "u", email: "e@example.test", accessToken: "tok" }) }));
vi.mock("@/lib/api/privacy", async (orig) => {
  const real = await orig<typeof import("@/lib/api/privacy")>();
  const wrap = (name: string) => (...a: unknown[]) => h.api(name, ...a);
  return { ...real, requestExport: wrap("requestExport"), getMyExport: wrap("getMyExport"), exportLink: wrap("exportLink"), requestAccountDeletion: wrap("requestAccountDeletion"), cancelAccountDeletion: wrap("cancelAccountDeletion"), requestWorkspaceDeletion: wrap("requestWorkspaceDeletion"), cancelWorkspaceDeletion: wrap("cancelWorkspaceDeletion"), executeWorkspaceDeletion: wrap("executeWorkspaceDeletion") };
});

import { cancelAccountDeletionAction, cancelWorkspaceDeletionAction, executeWorkspaceDeletionAction, exportLinkAction, getExportAction, requestAccountDeletionAction, requestExportAction, requestWorkspaceDeletionAction } from "./privacy-actions";

beforeEach(() => h.api.mockReset().mockResolvedValue({ id: ID }));

describe("the privacy actions", () => {
  it("ask the API with the person's token and the workspace only for the workspace's data", async () => {
    expect(await requestExportAction(T, "person", ID)).toEqual({ ok: true, data: { id: ID } });
    expect(h.api).toHaveBeenLastCalledWith("requestExport", "tok", ID, null);
    await requestExportAction(T, "workspace", ID);
    expect(h.api).toHaveBeenLastCalledWith("requestExport", "tok", ID, T);
    await getExportAction(T, ID);
    expect(h.api).toHaveBeenLastCalledWith("getMyExport", "tok", ID);
    await exportLinkAction(T, ID);
    expect(h.api).toHaveBeenLastCalledWith("exportLink", "tok", ID);
  });
  it("pass the typed words to the API as typed (it decides whether they match)", async () => {
    await requestAccountDeletionAction(T, ID, "Me@Example.test");
    expect(h.api).toHaveBeenLastCalledWith("requestAccountDeletion", "tok", ID, "Me@Example.test");
    await requestWorkspaceDeletionAction(T, ID, "Acme Silks");
    expect(h.api).toHaveBeenLastCalledWith("requestWorkspaceDeletion", "tok", T, ID, "Acme Silks");
    await cancelAccountDeletionAction(T, ID);
    await cancelWorkspaceDeletionAction(T, ID);
    await executeWorkspaceDeletionAction(T, ID);
    expect(h.api).toHaveBeenLastCalledWith("executeWorkspaceDeletion", "tok", T, ID);
  });
  it("refuse bad ids and empty or huge typed words before asking anything", async () => {
    for (const r of [await requestExportAction("bad", "person", ID), await requestExportAction(T, "person", "x"), await requestAccountDeletionAction(T, ID, "a@"), await requestAccountDeletionAction(T, ID, "x".repeat(321)), await requestWorkspaceDeletionAction(T, ID, ""), await requestWorkspaceDeletionAction(T, ID, "x".repeat(201))]) expect(r).toMatchObject({ ok: false, kind: "invalid" });
    expect(h.api).not.toHaveBeenCalled();
  });
  it("turn a refusal into a sentence of ours and keep the API's closed code", async () => {
    h.api.mockRejectedValueOnce(new ApiRequestError(409, "sole_owner", "x"));
    expect(await requestAccountDeletionAction(T, ID, "me@example.test")).toMatchObject({ ok: false, kind: "conflict", code: "sole_owner" });
    h.api.mockRejectedValueOnce(new ApiRequestError(403, "mfa_required", "x"));
    expect(await executeWorkspaceDeletionAction(T, ID)).toMatchObject({ ok: false, kind: "mfa", mfa: true });
    h.api.mockRejectedValueOnce(new ApiRequestError(429, "privacy_rate_limited", "x"));
    expect(await requestExportAction(T, "person", ID)).toMatchObject({ ok: false, kind: "rate_limited" });
  });
  it("send a rejected session to sign-in", async () => {
    h.api.mockRejectedValueOnce(new ApiAuthError("x"));
    await expect(getExportAction(T, ID)).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});
