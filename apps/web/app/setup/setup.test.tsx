import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { redirectMock } from "@/test/helpers";

const push = vi.fn();
const requireUser = vi.fn();
const fetchAccountSetup = vi.fn();
const completeSetup = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), redirect: (to: string) => redirectMock(to) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/account", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/account")>()), fetchAccountSetup: (...a: unknown[]) => fetchAccountSetup(...a) }));
vi.mock("../app/setup/actions", () => ({ completeSetup: (...a: unknown[]) => completeSetup(...a) }));

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import type { CompleteSetupResult } from "@/lib/api/signup";

import SetupPage from "./page";
import { SetupForm, type SetupWords } from "./setup-form";

const words: SetupWords = { type: "What kind of business is it?", types: [{ value: "textiles", label: "Textiles" }, { value: "other", label: "Other" }], language: "Which language should the app use?", submit: "Continue", error: "Something went wrong." };

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "u", accessToken: "t" });
  fetchAccountSetup.mockResolvedValue({ state: "needed", tenantId: null, businessName: "Asha Silks" });
});
afterEach(cleanup);

describe("SetupForm", () => {

  it("sends the kind of business and the language, then goes to the app (Today)", async () => {
    const action = vi.fn(async (): Promise<CompleteSetupResult> => ({ ok: true }));
    render(<SetupForm words={words} lang="te" action={action} />);
    expect(screen.getByRole("radio", { name: "తెలుగు" })).toBeChecked(); // the language the person is already using
    fireEvent.click(screen.getByRole("radio", { name: "Other" }));
    fireEvent.submit(screen.getByRole("button", { name: "Continue" }).closest("form")!);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/app"));
    expect(action).toHaveBeenCalledWith({ businessType: "other", language: "te" });
  });
  it("makes the chosen language the one the app speaks", async () => {
    const action = vi.fn(async (): Promise<CompleteSetupResult> => ({ ok: true }));
    render(<SetupForm words={words} lang="en" action={action} />);
    fireEvent.click(screen.getByRole("radio", { name: "हिन्दी" }));
    fireEvent.submit(screen.getByRole("button", { name: "Continue" }).closest("form")!);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/app"));
    expect(document.cookie).toContain("sme_lang=hi");
    expect(action).toHaveBeenCalledWith({ businessType: "textiles", language: "hi" });
  });
  it("a refusal the API explains is shown as it sent it (English); any other failure, the generic sentence; the screen stays", async () => {
    const action = vi.fn(async (): Promise<CompleteSetupResult> => ({ ok: false, error: "Your plan includes one workspace and you already have it." }));
    render(<SetupForm words={words} lang="te" action={action} />);
    fireEvent.submit(screen.getByRole("button", { name: "Continue" }).closest("form")!);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Your plan includes one workspace and you already have it.");
    expect(alert).toHaveAttribute("lang", "en");
    action.mockRejectedValue(new Error("network"));
    fireEvent.submit(screen.getByRole("button", { name: "Continue" }).closest("form")!);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong."));
    expect(screen.getByRole("alert")).not.toHaveAttribute("lang");
    expect(push).not.toHaveBeenCalled();
  });
});

describe("/setup", () => {
  it("needs a session, and draws the two questions in the visitor's language", async () => {
    render(await SetupPage());
    expect(requireUser).toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1, name: "Set up your business" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio").length).toBe(3 + 4); // three kinds of business (textiles, construction, other), four languages
    expect(fetchAccountSetup).toHaveBeenCalledWith("t");
  });
  it("is wired to the real completeSetup action", async () => {
    completeSetup.mockResolvedValue({ ok: true });
    render(await SetupPage());
    fireEvent.submit(screen.getByRole("button", { name: "Continue" }).closest("form")!);
    await waitFor(() => expect(completeSetup).toHaveBeenCalledWith({ businessType: "textiles", language: "en" }));
  });
  it("sends a person it has nothing to do for on to /app: the business exists, or an invited person", async () => {
    fetchAccountSetup.mockResolvedValue({ state: "done", tenantId: "22222222-2222-2222-2222-222222222222", businessName: null });
    await expect(SetupPage()).rejects.toThrow(/app/);
    fetchAccountSetup.mockResolvedValue({ state: "none", tenantId: null, businessName: null });
    await expect(SetupPage()).rejects.toThrow(/app/);
  });
  it("sends a rejected session to sign in, and still shows the form when the state cannot be read (the action decides)", async () => {
    fetchAccountSetup.mockRejectedValue(new ApiAuthError("x"));
    await expect(SetupPage()).rejects.toThrow(/login/);
    fetchAccountSetup.mockRejectedValue(new ApiRequestError(503, "api_unreachable", "x"));
    render(await SetupPage());
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  });
  it("a visitor with no session is sent to sign in", async () => {
    requireUser.mockImplementation(() => redirectMock("/login"));
    await expect(SetupPage()).rejects.toThrow();
  });
});
