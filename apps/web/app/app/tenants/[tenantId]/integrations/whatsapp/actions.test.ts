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
  return { ...real, putWhatsappAccount: wrap("put"), activateWhatsapp: wrap("activate"), disableWhatsapp: wrap("disable"), disconnectWhatsapp: wrap("disconnect"), connectWhatsapp: wrap("connect") };
});

import { activateWhatsappAction, connectWithFacebookAction, disableWhatsappAction, disconnectWhatsappAction, saveWhatsappAction } from "./actions";

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
  it("disconnect goes to the API's disconnect with the person's token and answers the account as it now stands", async () => {
    expect(await disconnectWhatsappAction(T)).toEqual({ ok: true, data: { configured: true } });
    expect(h.api).toHaveBeenLastCalledWith("disconnect", "tok", T);
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

describe("Connect with Facebook (Embedded Signup)", () => {
  const SIGNUP = { code: "AQBcodecodecode1234", wabaId: "123456789", phoneNumberId: "987654321" };
  it("sends the code and the two ids with the person's token and says the number and the name", async () => {
    h.api.mockResolvedValue({ connected: true, displayPhone: "+91 98765 43210", verifiedName: "Neelambari Silks", status: "active" });
    expect(await connectWithFacebookAction(T, SIGNUP)).toEqual({ ok: true, data: { connected: true, displayPhone: "+91 98765 43210", verifiedName: "Neelambari Silks", status: "active" } });
    expect(h.api).toHaveBeenCalledWith("connect", "tok", T, SIGNUP);
  });
  it("passes coexistence:true on; anything else in that field is refused", async () => {
    h.api.mockResolvedValue({ connected: true });
    await connectWithFacebookAction(T, { ...SIGNUP, coexistence: true });
    expect(h.api).toHaveBeenLastCalledWith("connect", "tok", T, { ...SIGNUP, coexistence: true });
    expect(await connectWithFacebookAction(T, { ...SIGNUP, coexistence: false as never })).toMatchObject({ ok: false, kind: "invalid" });
  });
  it("refuses a code or ids of the wrong shape, and a bad workspace, before asking the API", async () => {
    for (const bad of [{ ...SIGNUP, code: "short" }, { ...SIGNUP, code: "has space in it 123" }, { ...SIGNUP, wabaId: "12ab" }, { ...SIGNUP, phoneNumberId: "" }]) expect(await connectWithFacebookAction(T, bad)).toMatchObject({ ok: false, kind: "invalid" });
    expect(await connectWithFacebookAction("nope", SIGNUP)).toMatchObject({ ok: false, kind: "invalid" });
    expect(h.api).not.toHaveBeenCalled();
  });
  it("the API's refusals come back as our sentences", async () => {
    h.api.mockRejectedValueOnce(new ApiRequestError(409, "whatsapp_no_access", "x"));
    expect(await connectWithFacebookAction(T, SIGNUP)).toMatchObject({ ok: false, code: "whatsapp_no_access" });
  });
});
