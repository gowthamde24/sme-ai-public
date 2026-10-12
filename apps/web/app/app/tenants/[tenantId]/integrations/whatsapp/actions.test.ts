import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "@/lib/api/client";

const T = "11111111-1111-4111-8111-111111111111";
const h = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`NEXT_REDIRECT:${to}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: "u", email: "e@example.test", accessToken: "tok" }) }));
vi.mock("@/lib/api/whatsapp", async (orig) => {
  const real = await orig<typeof import("@/lib/api/whatsapp")>();
  const wrap = (n: string) => (...a: unknown[]) => h.api(n, ...a);
  return { ...real, putWhatsappAccount: wrap("put"), activateWhatsapp: wrap("activate"), disableWhatsapp: wrap("disable") };
});

import { activateWhatsappAction, disableWhatsappAction, saveWhatsappAction } from "./actions";

const GOOD = { wabaId: "123456789", phoneNumberId: "987654321", displayPhone: "+91 98765 43210", coexistence: false, tokenRef: "SHOP_TOKEN" };
beforeEach(() => h.api.mockReset().mockResolvedValue({ configured: true }));

describe("the Connect WhatsApp actions", () => {
  it("save the typed details with the person's token", async () => {
    expect(await saveWhatsappAction(T, GOOD)).toEqual({ ok: true, data: { configured: true } });
    expect(h.api).toHaveBeenCalledWith("put", "tok", T, GOOD);
  });
  it("switch on and off", async () => {
    await activateWhatsappAction(T);
    expect(h.api).toHaveBeenLastCalledWith("activate", "tok", T);
    await disableWhatsappAction(T);
    expect(h.api).toHaveBeenLastCalledWith("disable", "tok", T);
  });
  it.each([{ ...GOOD, wabaId: "abc" }, { ...GOOD, phoneNumberId: "" }, { ...GOOD, tokenRef: "a b" }, { ...GOOD, displayPhone: "x".repeat(41) }, { ...GOOD, coexistence: "yes" }])("refuse %j before asking", async (bad) => {
    expect(await saveWhatsappAction(T, bad as never)).toMatchObject({ ok: false, kind: "invalid" });
    expect(h.api).not.toHaveBeenCalled();
  });
  it("refuse a workspace id that is not one", async () => {
    expect(await activateWhatsappAction("x")).toMatchObject({ ok: false, kind: "invalid" });
  });
  it("say a refusal in words and keep the closed code", async () => {
    h.api.mockRejectedValueOnce(new ApiRequestError(403, "mfa_required", "x"));
    expect(await saveWhatsappAction(T, GOOD)).toMatchObject({ ok: false, kind: "mfa", mfa: true });
    h.api.mockRejectedValueOnce(new ApiRequestError(503, "whatsapp_unavailable", "x"));
    expect(await activateWhatsappAction(T)).toMatchObject({ ok: false, kind: "unavailable", code: "whatsapp_unavailable" });
  });
});
