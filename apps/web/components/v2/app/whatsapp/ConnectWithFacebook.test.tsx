import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { wordsFor } from "@/i18n/app-words";
import type { FbLoginResponse, FbSdk } from "@/lib/whatsapp/embedded-signup";

import { ConnectWithFacebook } from "./ConnectWithFacebook";

afterEach(cleanup);
const WORDS = wordsFor("en", ["wa.", "apierr."]);
const CONFIG = { appId: "APP1", configId: "CFG1", graphVersion: "v25.0" };
const finish = { type: "WA_EMBEDDED_SIGNUP", event: "FINISH", data: { waba_id: "123456789", phone_number_id: "987654321" } };
const post = (data: unknown, origin = "https://www.facebook.com") => act(() => void window.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(data), origin })));

/** A fake Meta SDK: `login` keeps its callback so a test answers when it wants (before or after the window message). */
function fake() {
  let cb: ((r: FbLoginResponse) => void) | null = null;
  const login = vi.fn((c: (r: FbLoginResponse) => void, _options?: Record<string, unknown>) => {
    cb = c;
  });
  const sdk = vi.fn(async () => ({ init: vi.fn(), login }) as FbSdk);
  return { sdk, login, answer: (r: FbLoginResponse) => act(() => cb?.(r)) };
}
const connect = (over?: object) => vi.fn(async () => ({ ok: true as const, data: { connected: true, displayPhone: "+91 98765 43210", verifiedName: "Neelambari Silks", status: "active", ...over } }));
const view = (f: ReturnType<typeof fake>, c = connect(), onConnected = vi.fn()) => {
  render(<ConnectWithFacebook words={WORDS} config={CONFIG} connect={c} onConnected={onConnected} sdk={f.sdk} />);
  return { c, onConnected };
};
const press = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Connect with Facebook" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Opening Meta…" })).toBeDisabled());
};

describe("Connect with Facebook", () => {
  it("opens Meta's window with our configuration; the code first and then the message connects once, and says the number and the name", async () => {
    const f = fake();
    const { c, onConnected } = view(f);
    expect(f.sdk).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Connect with Facebook" }));
    await waitFor(() => expect(f.login).toHaveBeenCalled());
    expect(f.sdk).toHaveBeenCalledWith("APP1", "v25.0");
    expect(f.login.mock.calls[0][1]).toMatchObject({ config_id: "CFG1", response_type: "code", extras: { featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3" } });
    f.answer({ authResponse: { code: "AQBcodecodecode1234" } });
    expect(c).not.toHaveBeenCalled();
    await post(finish);
    await waitFor(() => expect(c).toHaveBeenCalledWith({ code: "AQBcodecodecode1234", wabaId: "123456789", phoneNumberId: "987654321" }));
    expect(c).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Connected: +91 98765 43210 Neelambari Silks")).toBeInTheDocument();
    expect(onConnected).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Connect with Facebook" })).toBeNull();
  });
  it("the message first and then the code works too, and a second FINISH does not connect twice", async () => {
    const f = fake();
    const { c } = view(f);
    await press();
    await post(finish);
    await post(finish);
    expect(c).not.toHaveBeenCalled();
    f.answer({ authResponse: { code: "AQBcodecodecode1234" } });
    await waitFor(() => expect(c).toHaveBeenCalledTimes(1));
  });
  it("a message from another address is ignored", async () => {
    const f = fake();
    const { c } = view(f);
    await press();
    f.answer({ authResponse: { code: "AQBcodecodecode1234" } });
    await post(finish, "https://evil.example");
    expect(c).not.toHaveBeenCalled();
  });
  it("closing the window says nothing was connected: by the CANCEL message, or by a login answer with no code; and the button works again", async () => {
    const f = fake();
    const { c } = view(f);
    await press();
    await post({ type: "WA_EMBEDDED_SIGNUP", event: "CANCEL", data: { current_step: "PHONE" } });
    expect(await screen.findByText(/You closed Meta's window, so nothing was connected/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect with Facebook" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Connect with Facebook" }));
    await waitFor(() => expect(f.login).toHaveBeenCalledTimes(2));
    f.answer({ authResponse: null, status: "unknown" });
    expect(await screen.findByText(/You closed Meta's window/)).toBeInTheDocument();
    expect(c).not.toHaveBeenCalled();
  });
  it("Meta's own reason is shown in words; without one the plain sentence", async () => {
    const f = fake();
    view(f);
    await press();
    await post({ type: "WA_EMBEDDED_SIGNUP", event: "ERROR", data: { error_message: "This number is already registered" } });
    expect(await screen.findByText("It did not work. Meta said: This number is already registered")).toBeInTheDocument();
    cleanup();
    const g = fake();
    view(g);
    await press();
    await post({ type: "WA_EMBEDDED_SIGNUP", event: "ERROR", data: {} });
    expect(await screen.findByText("It did not work. Nothing was connected.")).toBeInTheDocument();
  });
  it("when the SDK cannot be loaded (blocked) it says so and nothing is sent", async () => {
    const c = connect();
    render(<ConnectWithFacebook words={WORDS} config={CONFIG} connect={c} sdk={async () => Promise.reject(new Error("sdk_blocked"))} />);
    fireEvent.click(screen.getByRole("button", { name: "Connect with Facebook" }));
    expect(await screen.findByText("It did not work. Nothing was connected.")).toBeInTheDocument();
    expect(c).not.toHaveBeenCalled();
  });
  it("a refusal of our API is said in our words (the signup could not be checked) and the button is back", async () => {
    const f = fake();
    const refuse = vi.fn(async () => ({ ok: false as const, kind: "conflict" as const, code: "whatsapp_signup_invalid", error: "x" }));
    render(<ConnectWithFacebook words={WORDS} config={CONFIG} connect={refuse as never} sdk={f.sdk} />);
    await press();
    f.answer({ authResponse: { code: "AQBcodecodecode1234" } });
    await post(finish);
    expect(await screen.findByText("That sign-up could not be checked. Connect again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect with Facebook" })).toBeEnabled();
  });
});
