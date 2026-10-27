import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ role: "owner", save: vi.fn(), saveCampaign: vi.fn(), preview: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => h.revalidate(...a) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT:${to}`); } }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ accessToken: "tok", id: "u" }) }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: async () => ({ role: h.role }) }));
vi.mock("@/lib/opening-line/source", () => ({ saveOpeningLine: (...a: unknown[]) => h.save(...a), saveCampaignOpeningLine: (...a: unknown[]) => h.saveCampaign(...a), previewLine: (...a: unknown[]) => h.preview(...a) }));

import { previewOpeningLineAction, saveCampaignOpeningLineAction, saveOpeningLineAction } from "./opening-line-actions";

const T = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
beforeEach(() => {
  vi.clearAllMocks();
  h.role = "owner";
  h.save.mockResolvedValue({ ok: true, data: {} });
  h.saveCampaign.mockResolvedValue({ ok: true, data: {} });
  h.preview.mockResolvedValue({ ok: true, data: { audio: null, fake: true } });
});

describe("the opening-line server actions", () => {
  it("the Owner saves and the settings page is refreshed; the answer carries no text back", async () => {
    expect(await saveOpeningLineAction(T, { lines: {}, mentionAi: true })).toEqual({ ok: true });
    expect(h.save).toHaveBeenCalledWith({ token: "tok", tenantId: T }, { lines: {}, mentionAi: true });
    expect(h.revalidate).toHaveBeenCalledWith(`/app/tenants/${T}/settings`);
  });
  it("nobody else saves, for the business or a campaign; a bad id changes nothing", async () => {
    for (const role of ["admin", "sales", "viewer"]) {
      h.role = role;
      expect(await saveOpeningLineAction(T, { lines: {}, mentionAi: true })).toEqual({ ok: false, error: "forbidden" });
      expect(await saveCampaignOpeningLineAction(T, C, { lines: {}, mentionAi: null })).toEqual({ ok: false, error: "forbidden" });
    }
    h.role = "owner";
    expect(await saveOpeningLineAction("a/b", {})).toEqual({ ok: false, error: "forbidden" });
    expect(await saveCampaignOpeningLineAction(T, "../x", {})).toEqual({ ok: false, error: "forbidden" });
    expect(h.save).not.toHaveBeenCalled();
    expect(h.saveCampaign).not.toHaveBeenCalled();
  });
  it("the Owner and the Admin may hear a preview; Sales and Viewers may not", async () => {
    for (const role of ["owner", "admin"]) {
      h.role = role;
      expect(await previewOpeningLineAction(T, "en", "Hello Ravi", false)).toEqual({ ok: true, preview: { audio: null, fake: true } });
    }
    expect(h.preview).toHaveBeenLastCalledWith({ token: "tok", tenantId: T }, "en", "Hello Ravi", false);
    h.role = "sales";
    expect(await previewOpeningLineAction(T, "en", "Hello Ravi", true)).toEqual({ ok: false, error: "forbidden" });
  });
  it("a refusal of the source is passed on as its closed word", async () => {
    h.save.mockResolvedValue({ ok: false, error: "read_only" });
    expect(await saveOpeningLineAction(T, { lines: {}, mentionAi: true })).toEqual({ ok: false, error: "read_only" });
    expect(h.revalidate).not.toHaveBeenCalled();
  });
});
