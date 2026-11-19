import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ req: vi.fn() }));
vi.mock("./client", async (orig) => ({ ...(await orig<typeof import("./client")>()), apiRequest: (...a: unknown[]) => h.req(...a) }));

import { connectWhatsapp, getConnectConfig, parseConnectConfig } from "./whatsapp";

const T = "11111111-1111-4111-8111-111111111111";
beforeEach(() => h.req.mockReset());

describe("the Embedded Signup configuration", () => {
  it("reads what the browser needs and what is missing; the Graph version has a default", () => {
    expect(parseConnectConfig({ available: true, app_id: "1234567890", config_id: "9988776655", graph_version: "v25.0", missing: [] })).toEqual({ embeddedVersion: "v4", launchExtras: null, available: true, appId: "1234567890", configId: "9988776655", graphVersion: "v25.0", missing: [], onboardingTypes: [] });
    // Embedded Signup v5: the version and the ready-made extras of FB.login come from the API; an older API says nothing (v4, no extras)
    expect(parseConnectConfig({ available: true, app_id: "1234567890", config_id: "9988776655", embedded_version: "v5", launch_extras: { setup: {}, version: "v5" }, missing: [] })).toMatchObject({ embeddedVersion: "v5", launchExtras: { setup: {}, version: "v5" } });
    expect(parseConnectConfig({ available: true, app_id: "1234567890", config_id: "9988776655", embedded_version: "v9", launch_extras: [1], missing: [] })).toMatchObject({ embeddedVersion: "v4", launchExtras: null });
    expect(parseConnectConfig({ available: true, app_id: "1234567890", config_id: "9988776655", onboarding_types: ["cloud_api", "coexistence"], missing: [] }).onboardingTypes).toEqual(["cloud_api", "coexistence"]);
    expect(parseConnectConfig({ available: false, app_id: null, config_id: null, missing: ["app_id", "config_id"] })).toMatchObject({ available: false, appId: null, graphVersion: "v25.0", missing: ["app_id", "config_id"] });
  });
  it("is never 'available' without both ids, and refuses ids of odd shape", () => {
    expect(parseConnectConfig({ available: true, app_id: "1234567890", config_id: null, missing: [] }).available).toBe(false);
    expect(() => parseConnectConfig({ available: true, app_id: "has space", config_id: "1", missing: [] })).toThrow();
    expect(parseConnectConfig({ available: true, app_id: "1234567890", config_id: "55555", graph_version: "evil", missing: [] }).graphVersion).toBe("v25.0");
  });
  it("asks GET /whatsapp/connect/config; null when the API cannot say", async () => {
    h.req.mockResolvedValueOnce({ available: true, app_id: "1234567890", config_id: "55555", graph_version: "v25.0", missing: [] });
    expect((await getConnectConfig("tok", T))?.available).toBe(true);
    expect(h.req).toHaveBeenCalledWith(`/v1/tenants/${T}/whatsapp/connect/config`, "tok");
    h.req.mockRejectedValueOnce(new Error("404"));
    expect(await getConnectConfig("tok", T)).toBeNull();
  });
});

describe("POST /whatsapp/connect", () => {
  it("sends the code and the ids as the API names them and reads the number and the verified name", async () => {
    h.req.mockResolvedValueOnce({ connected: true, display_phone: "+91 98765 43210", verified_name: "Neelambari Silks", status: "active" });
    expect(await connectWhatsapp("tok", T, { code: "AQBcodecodecode1234", wabaId: "123456789", phoneNumberId: "987654321" })).toEqual({ connected: true, displayPhone: "+91 98765 43210", verifiedName: "Neelambari Silks", status: "active" });
    expect(h.req).toHaveBeenCalledWith(`/v1/tenants/${T}/whatsapp/connect`, "tok", { method: "POST", body: JSON.stringify({ code: "AQBcodecodecode1234", waba_id: "123456789", phone_number_id: "987654321" }) });
  });
  it("sends coexistence:true only when asked to (the API's model is strict: an older API must never get the field)", async () => {
    h.req.mockResolvedValue({ connected: true, display_phone: null, verified_name: null, status: "active" });
    await connectWhatsapp("tok", T, { code: "AQBcodecodecode1234", wabaId: "123456789", phoneNumberId: "987654321", coexistence: true });
    expect(JSON.parse((h.req.mock.calls[0][2] as { body: string }).body)).toEqual({ code: "AQBcodecodecode1234", waba_id: "123456789", phone_number_id: "987654321", coexistence: true });

    await connectWhatsapp("tok", T, { code: "AQBcodecodecode1234", wabaId: "123456789", phoneNumberId: "987654321" });
    expect(JSON.parse((h.req.mock.calls[1][2] as { body: string }).body)).not.toHaveProperty("coexistence");
  });
  it("never sends a code or an id of the wrong shape", async () => {
    await expect(connectWhatsapp("tok", T, { code: "x", wabaId: "123456789", phoneNumberId: "987654321" })).rejects.toThrow();
    await expect(connectWhatsapp("tok", T, { code: "AQBcodecodecode1234", wabaId: "abc", phoneNumberId: "987654321" })).rejects.toThrow();
    expect(h.req).not.toHaveBeenCalled();
  });
});
