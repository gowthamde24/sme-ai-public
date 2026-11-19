import { afterEach, describe, expect, it, vi } from "vitest";

import { FB_ORIGINS, SDK_URL, loadFacebookSdk, loginOptions, plainReason, readSignupMessage, resetSdkForTests } from "./embedded-signup";

afterEach(() => {
  delete window.FB;
  delete window.fbAsyncInit;
  document.head.querySelectorAll("script").forEach((s) => s.remove());
  resetSdkForTests();
});

describe("what FB.login is asked", () => {
  it("is Embedded Signup with our configuration, a code, and the app-coexistence feature type", () => {
    expect(loginOptions("CFG123")).toEqual({ config_id: "CFG123", response_type: "code", override_default_response_type: true, extras: { setup: {}, featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3" } });
  });
});

describe("the window message of Meta's signup", () => {
  const ok = { type: "WA_EMBEDDED_SIGNUP", event: "FINISH", data: { waba_id: "123456789", phone_number_id: "987654321" } };
  it("FINISH with both ids (an object or a JSON string) means finished; the app-onboarding event does too", () => {
    expect(readSignupMessage({ origin: "https://www.facebook.com", data: ok })).toEqual({ kind: "finish", wabaId: "123456789", phoneNumberId: "987654321" });
    expect(readSignupMessage({ origin: "https://web.facebook.com", data: JSON.stringify(ok) })).toEqual({ kind: "finish", wabaId: "123456789", phoneNumberId: "987654321" });
    expect(readSignupMessage({ origin: "https://www.facebook.com", data: { ...ok, event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" } })?.kind).toBe("finish");
  });
  it("CANCEL means the person closed the window; ERROR carries Meta's reason, cleaned", () => {
    expect(readSignupMessage({ origin: "https://www.facebook.com", data: { type: "WA_EMBEDDED_SIGNUP", event: "CANCEL", data: { current_step: "PHONE" } } })).toEqual({ kind: "cancel" });
    expect(readSignupMessage({ origin: "https://www.facebook.com", data: { type: "WA_EMBEDDED_SIGNUP", event: "ERROR", data: { error_message: "  Number <b>already</b>\nin use  " } } })).toEqual({ kind: "error", reason: "Number b already /b in use" });
  });
  it("a FINISH without usable ids is an error, not a success", () => {
    expect(readSignupMessage({ origin: "https://www.facebook.com", data: { ...ok, data: { waba_id: "12" } } })).toEqual({ kind: "error", reason: "" });
  });
  it("anything from another origin, another type, a non-object or broken JSON is ignored", () => {
    expect(readSignupMessage({ origin: "https://evil.example", data: ok })).toBeNull();
    expect(readSignupMessage({ origin: "https://www.facebook.com", data: { ...ok, type: "OTHER" } })).toBeNull();
    expect(readSignupMessage({ origin: "https://www.facebook.com", data: "not json" })).toBeNull();
    expect(readSignupMessage({ origin: "https://www.facebook.com", data: 5 })).toBeNull();
    expect(readSignupMessage({ origin: "https://www.facebook.com", data: { type: "WA_EMBEDDED_SIGNUP", event: "SOMETHING_ELSE" } })).toBeNull();
    expect(FB_ORIGINS).toEqual(["https://www.facebook.com", "https://web.facebook.com"]);
  });
  it("plainReason keeps one short line", () => {
    expect(plainReason("x".repeat(500))).toHaveLength(160);
    expect(plainReason(null)).toBe("");
  });
});

describe("loading Meta's SDK", () => {
  it("adds the script once, on the first ask; when it calls fbAsyncInit the SDK is initialised with our app id and version", async () => {
    const init = vi.fn();
    const p = loadFacebookSdk("APP1", "v25.0");
    const scripts = [...document.head.querySelectorAll("script")];
    expect(scripts).toHaveLength(1);
    expect(scripts[0].src).toBe(SDK_URL);
    expect(scripts[0].crossOrigin).toBe("anonymous");
    window.FB = { init, login: vi.fn() };
    window.fbAsyncInit?.();
    await expect(p).resolves.toBe(window.FB);
    expect(init).toHaveBeenCalledWith({ appId: "APP1", autoLogAppEvents: true, xfbml: false, version: "v25.0" });
    await loadFacebookSdk("APP1", "v25.0");
    expect(init).toHaveBeenCalledTimes(1);
    expect(document.head.querySelectorAll("script")).toHaveLength(1);
  });
  it("rejects when the script cannot be loaded (blocked, offline)", async () => {
    const p = loadFacebookSdk("APP1", "v25.0");
    (document.head.querySelector("script") as HTMLScriptElement).onerror?.(new Event("error"));
    await expect(p).rejects.toThrow("sdk_blocked");
  });
});
