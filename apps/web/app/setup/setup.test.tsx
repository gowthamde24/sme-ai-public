import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { redirectMock } from "@/test/helpers";

const push = vi.fn();
const requireUser = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), redirect: (to: string) => redirectMock(to) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));

import type { ActionResult } from "../signup/contract";
import SetupPage from "./page";
import { SetupForm, type SetupWords } from "./setup-form";

const words: SetupWords = { type: "What kind of business is it?", types: [{ value: "wholesaler", label: "Wholesaler" }, { value: "other", label: "Other" }], language: "Which language should the app use?", submit: "Continue", notAvailable: "Not available yet.", error: "Something went wrong." };

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "u", accessToken: "t" });
});
afterEach(cleanup);

describe("SetupForm", () => {
  it("without the server action it cannot be sent and says 'Not available yet'", () => {
    render(<SetupForm words={words} lang="en" />);
    expect(screen.getByRole("status")).toHaveTextContent("Not available yet.");
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });
  it("sends the kind of business and the language, then goes to the app (Today)", async () => {
    const action = vi.fn(async (): Promise<ActionResult> => ({ ok: true }));
    render(<SetupForm words={words} lang="te" action={action} />);
    expect(screen.getByRole("radio", { name: "తెలుగు" })).toBeChecked(); // the language the person is already using
    fireEvent.click(screen.getByRole("radio", { name: "Other" }));
    fireEvent.submit(screen.getByRole("button", { name: "Continue" }).closest("form")!);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/app"));
    expect(action).toHaveBeenCalledWith({ businessType: "other", language: "te" });
  });
  it("a refusal says so and stays on the screen", async () => {
    const action = vi.fn(async (): Promise<ActionResult> => ({ ok: false, error: "x" }));
    render(<SetupForm words={words} lang="en" action={action} />);
    fireEvent.submit(screen.getByRole("button", { name: "Continue" }).closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong.");
    expect(push).not.toHaveBeenCalled();
  });
});

describe("/setup", () => {
  it("needs a session, and draws the two questions in the visitor's language", async () => {
    render(await SetupPage());
    expect(requireUser).toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1, name: "Set up your business" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio").length).toBe(5 + 4); // five kinds of business, four languages
  });
  it("a visitor with no session is sent to sign in", async () => {
    requireUser.mockImplementation(() => redirectMock("/login"));
    await expect(SetupPage()).rejects.toThrow();
  });
});
