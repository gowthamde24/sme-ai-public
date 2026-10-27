import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
// the kinds of business come from the API (GET /v1/packs, job CK): here the real pack files through the API's shapes
const packList = vi.fn();
vi.mock("@/lib/api/pack", async (orig) => ({ ...(await orig<typeof import("@/lib/api/pack")>()), listPacks: () => packList() }));

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import type { CompleteSetupResult } from "@/lib/api/signup";

import { parsePackSummary } from "@/lib/api/pack";
import { packsWire, selectableIds } from "@/lib/packs/pack-test-kit";

import SetupPage from "./page";
import { SetupForm, type SetupWords } from "./setup-form";

const SUMMARIES = packsWire().packs.map(parsePackSummary);
const IDS = selectableIds();
const TYPE_WORDS = { label: "Business type", placeholder: "Choose or search your business type", none: "No match. Choose Other and tell us what you do.", otherAsk: "What is your business?", otherHint: "2 to 60 letters." };
const words: SetupWords = { type: TYPE_WORDS, name: "Your business name", nameHelp: "Customers see this name.", language: "Which language should the app use?", submit: "Continue", error: "Something went wrong." };
const groups = [
  { key: "deep", label: "Built especially for", options: [{ id: "textiles", name: "Textiles", tagline: "Sarees" }] },
  { key: "leads", label: "Lead Desk", options: [{ id: "gym", name: "Gym", tagline: "Memberships" }] },
  { key: "other", label: "Other", options: [{ id: "other", name: "Other", tagline: "Anything else" }] },
];
const pick = (name: string) => {
  fireEvent.focus(screen.getByRole("combobox"));
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: new RegExp(name) }));
};
const submit = () => fireEvent.submit(screen.getByRole("button", { name: "Continue" }).closest("form")!);
const name = (v: string) => fireEvent.change(screen.getByLabelText("Your business name"), { target: { value: v } });

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "u", accessToken: "t" });
  packList.mockResolvedValue(SUMMARIES);
  fetchAccountSetup.mockResolvedValue({ state: "needed", tenantId: null, businessName: "Asha Silks" });
});
afterEach(cleanup);

describe("SetupForm: only the kind of business and its name are asked", () => {
  it("sends the chosen kind, the name and the language, then goes to the app (Today)", async () => {
    const action = vi.fn(async (): Promise<CompleteSetupResult> => ({ ok: true }));
    render(<SetupForm words={words} lang="te" action={action} groups={groups} />);
    expect(screen.getByRole("radio", { name: "తెలుగు" })).toBeChecked(); // the language the person is already using
    pick("Gym");
    name("  Iron Gym ");
    submit();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/app"));
    expect(action).toHaveBeenCalledWith({ businessType: "gym", language: "te", businessName: "Iron Gym" });
  });
  it("starts with the kind chosen at sign-up and needs only the name", async () => {
    const action = vi.fn(async (): Promise<CompleteSetupResult> => ({ ok: true }));
    render(<SetupForm words={words} lang="en" action={action} groups={groups} remembered="textiles" />);
    expect(screen.getByRole("combobox")).toHaveAttribute("placeholder", "Textiles");
    name("Asha Silks");
    submit();
    await waitFor(() => expect(action).toHaveBeenCalledWith({ businessType: "textiles", language: "en", businessName: "Asha Silks" }));
  });
  it("'Other' asks what the business is (2 to 60 letters) and sends it with the choice", async () => {
    const action = vi.fn(async (): Promise<CompleteSetupResult> => ({ ok: true }));
    render(<SetupForm words={words} lang="en" action={action} groups={groups} otherId="other" />);
    expect(screen.queryByLabelText("What is your business?")).toBeNull();
    pick("Other");
    const label = screen.getByLabelText("What is your business?");
    expect(label).toBeRequired();
    expect(label).toHaveAttribute("minlength", "2");
    expect(label).toHaveAttribute("maxlength", "60");
    fireEvent.change(label, { target: { value: "Paver block dealer" } });
    name("Rao Pavers");
    submit();
    await waitFor(() => expect(action).toHaveBeenCalledWith({ businessType: "other", language: "en", businessName: "Rao Pavers", businessLabel: "Paver block dealer" }));
  });
  it("makes the chosen language the one the app speaks", async () => {
    const action = vi.fn(async (): Promise<CompleteSetupResult> => ({ ok: true }));
    render(<SetupForm words={words} lang="en" action={action} groups={groups} remembered="textiles" />);
    fireEvent.click(screen.getByRole("radio", { name: "हिन्दी" }));
    name("Asha Silks");
    submit();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/app"));
    expect(document.cookie).toContain("sme_lang=hi");
    expect(action).toHaveBeenCalledWith({ businessType: "textiles", language: "hi", businessName: "Asha Silks" });
  });
  it("no kind chosen says so and sends nothing", () => {
    const action = vi.fn();
    render(<SetupForm words={words} lang="en" action={action} groups={groups} />);
    name("Asha Silks");
    submit();
    expect(screen.getByRole("alert")).toHaveTextContent("No match.");
    expect(action).not.toHaveBeenCalled();
  });
  it("a refusal the API explains is shown as it sent it (English); any other failure, the generic sentence; the screen stays", async () => {
    const action = vi.fn(async (): Promise<CompleteSetupResult> => ({ ok: false, error: "Your plan includes one workspace and you already have it." }));
    render(<SetupForm words={words} lang="te" action={action} groups={groups} remembered="textiles" />);
    name("Asha Silks");
    submit();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Your plan includes one workspace and you already have it.");
    expect(alert).toHaveAttribute("lang", "en");
    action.mockRejectedValue(new Error("network"));
    submit();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong."));
    expect(screen.getByRole("alert")).not.toHaveAttribute("lang");
    expect(push).not.toHaveBeenCalled();
  });
});

describe("/setup", () => {
  it("needs a session, and draws the questions in the visitor's language: the kind (one list), the name, the language", async () => {
    render(await SetupPage());
    expect(requireUser).toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1, name: "Set up your business" })).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByLabelText("Your business name")).toBeRequired();
    expect(screen.getAllByRole("radio")).toHaveLength(4); // the four languages: the kinds are in the list, not radios
    expect(fetchAccountSetup).toHaveBeenCalledWith("t");
    fireEvent.focus(screen.getByRole("combobox"));
    expect(within(screen.getByRole("listbox")).getAllByRole("option")).toHaveLength(IDS.length);
  });
  it("is wired to the real completeSetup action, with the kind the account carries", async () => {
    requireUser.mockResolvedValue({ id: "u", accessToken: "t", signupPack: IDS[1] });
    completeSetup.mockResolvedValue({ ok: true });
    render(await SetupPage());
    name("Asha Silks");
    submit();
    await waitFor(() => expect(completeSetup).toHaveBeenCalledWith({ businessType: IDS[1], language: "en", businessName: "Asha Silks" }));
  });
  it("an unknown or malformed kind from the account is not trusted: nothing is chosen", async () => {
    for (const signupPack of ["a_type_nobody_offers", "Not A Code"]) {
      requireUser.mockResolvedValue({ id: "u", accessToken: "t", signupPack });
      render(await SetupPage());
      expect(screen.getByRole("combobox")).toHaveAttribute("placeholder", "Choose or search your business type");
      cleanup();
    }
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
  it("when the server cannot list the kinds, the kind the account carries still goes (the database decides) and the name is asked", async () => {
    packList.mockRejectedValue(new Error("down"));
    requireUser.mockResolvedValue({ id: "u", accessToken: "t", signupPack: IDS[1] });
    completeSetup.mockResolvedValue({ ok: true });
    render(await SetupPage());
    expect(screen.queryByRole("combobox")).toBeNull();
    name("Asha Silks");
    submit();
    await waitFor(() => expect(completeSetup).toHaveBeenCalledWith({ businessType: IDS[1], language: "en", businessName: "Asha Silks" }));
  });
});
