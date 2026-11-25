import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push, replace: vi.fn(), refresh: nav.refresh }) }));

import { appDict } from "@/i18n/app";
import type { KycStatus } from "@/lib/api/business-kyc";
import type { OwnNumber, SearchResult } from "@/lib/phone-picker/types";
import { expectNoSentenceForm } from "../../../../test/helpers/no-sentence-form";

import { PREFILL_KEY, PhoneBuy, type BuyActions, type BuyAnswer } from "./PhoneBuy";
import { VerifyBusiness, type VerifyActions } from "./VerifyBusiness";

const WORDS = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("pick.")));
const N = (n: string) => ({ number: n, display: `+91 ${n.slice(3, 8)} ${n.slice(8)}`, type: "mobile" as const });
const LIST: SearchResult = { ok: true, numbers: [N("+919429492465"), N("+919429492466")], page: 1, more: false };
const buyActions = (over: { buy?: BuyAnswer; search?: SearchResult } = {}) => ({
  search: vi.fn(async () => over.search ?? LIST),
  buy: vi.fn(async () => over.buy ?? ({ ok: true, number: { number: "+919429492465", display: "+91 94294 92465" } } as BuyAnswer)),
}) satisfies BuyActions;

afterEach(cleanup);
beforeEach(() => {
  nav.push.mockClear();
  nav.refresh.mockClear();
  window.sessionStorage.clear();
});

const drawBuy = async (a = buyActions(), props: { canEdit?: boolean } = {}) => {
  const out = render(<PhoneBuy words={WORDS} actions={a} canEdit={props.canEdit ?? true} email="asha@shop.in" verifyHref="/v?verify=1" />);
  await screen.findByText("+91 94294 92465");
  return out;
};
const step = (n: number) => document.querySelector(`[data-step="${n}"]`) as HTMLElement;
const states = () => [1, 2, 3, 4].map((n) => step(n).getAttribute("data-state-of"));

describe("Get a phone number: four steps in one page", () => {
  it("one step in hand at a time; Choose a number first, with Mobile and Landline, the digits, the numbers, never a price", async () => {
    const { container } = await drawBuy();
    expect(states()).toEqual(["now", "off", "off", "off"]);
    expect([1, 2, 3, 4].map((n) => within(step(n)).getAllByRole("heading")[0].textContent)).toEqual(["Choose a number", "Your calling account", "Verification", "How you will use this number"]);
    expect(screen.getByRole("button", { name: "Mobile" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Landline" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByLabelText("Starts with (optional)")).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Use this number" })).toBeDisabled();
    expect(container.textContent).not.toMatch(/₹|Rs\.?\s?\d|price|per month/i);
    expectNoSentenceForm(container);
  });

  it("the Landline tab asks for landline numbers; the digits go with Search", async () => {
    const a = buyActions();
    await drawBuy(a);
    fireEvent.click(screen.getByRole("button", { name: "Landline" }));
    await waitFor(() => expect(a.search).toHaveBeenCalledWith("landline", "", 1));
    fireEvent.change(screen.getByLabelText("Starts with (optional)"), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(a.search).toHaveBeenLastCalledWith("landline", "40", 1));
  });

  it("step 2: Individual | Business, a name, the e-mail you signed in with (not editable), and 'You cannot change these later'", async () => {
    const { container } = await drawBuy();
    fireEvent.click(screen.getAllByRole("radio")[0]);
    fireEvent.click(screen.getByRole("button", { name: "Use this number" }));
    expect(states()).toEqual(["done", "now", "off", "off"]);
    expect(step(1)).toHaveTextContent("+91 94294 92465");
    expect(screen.getByRole("button", { name: "Individual" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Business" }));
    expect(screen.getByRole("button", { name: "Business" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Email")).toHaveValue("asha@shop.in");
    expect(screen.getByLabelText("Email")).toHaveAttribute("readonly");
    expect(screen.getByText("You cannot change these later. Check them once.")).toBeInTheDocument();
    // every field is mandatory: "Required" beside the label, Continue off until the name is a name, one plain sentence once the field was touched
    expect(screen.getByLabelText("Full name")).toBeRequired();
    expect(screen.getByLabelText("Email")).toBeRequired();
    expect(within(step(2)).getAllByText("Required")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    fireEvent.blur(screen.getByLabelText("Full name"));
    expect(screen.getByText("This is required.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "A" } });
    expect(screen.getByText("Write your full name, at least two letters.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(states()).toEqual(["done", "now", "off", "off"]);
    expectNoSentenceForm(container);
  });

  it("step 3 says: you verify yourself after you buy; PAN and Aadhaar make you, not us, the registered owner; no calls until it is done", async () => {
    await drawBuy();
    fireEvent.click(screen.getAllByRole("radio")[0]);
    fireEvent.click(screen.getByRole("button", { name: "Use this number" }));
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Asha Rao" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(states()).toEqual(["done", "done", "now", "off"]);
    const box = document.querySelector('[data-part="verify-box"]') as HTMLElement;
    expect(box).toHaveTextContent("You verify yourself after you buy.");
    expect(box).toHaveTextContent("A quick check of your PAN and Aadhaar makes you, not us, the registered owner of the number. Until it is done the number cannot make calls.");
  });

  async function toStep4(a: ReturnType<typeof buyActions>, canEdit = true) {
    await drawBuy(a, { canEdit });
    fireEvent.click(screen.getAllByRole("radio")[1]);
    fireEvent.click(screen.getByRole("button", { name: "Use this number" }));
    fireEvent.click(screen.getByRole("button", { name: "Business" }));
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Asha Rao" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  }

  it("step 4: the tick is required, the Confirm button stays off until it is ticked, and nothing is bought before it", async () => {
    const a = buyActions();
    await toStep4(a);
    expect(states()).toEqual(["done", "done", "done", "now"]);
    const confirm = screen.getByRole("button", { name: "Confirm and get this number" });
    const tick = screen.getByRole("checkbox");
    expect(tick).toBeRequired();
    expect(tick).not.toBeChecked();
    expect(confirm).toBeDisabled();
    expect(a.buy).not.toHaveBeenCalled();
    fireEvent.click(tick);
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(a.buy).toHaveBeenCalledWith({ number: "+919429492466", type: "mobile", accountType: "business", agree: true }));
    await waitFor(() => expect(nav.refresh).toHaveBeenCalled());
    expect(JSON.parse(window.sessionStorage.getItem(PREFILL_KEY) ?? "{}")).toEqual({ accountType: "business", fullName: "Asha Rao" });
  });

  it("the API wants the verification first: one plain sentence and a way to the Verify page, never a raw code", async () => {
    await toStep4(buyActions({ buy: { ok: false, error: "unavailable", reason: "kyc_required" } }));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Confirm and get this number" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Verify your business first to get a number in its name.");
    expect(within(alert).getByRole("link", { name: "Verify your business" })).toHaveAttribute("href", "/v?verify=1");
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it("a number someone just took: the sentence, and back to the list", async () => {
    const a = buyActions({ buy: { ok: false, error: "taken" } });
    await toStep4(a);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Confirm and get this number" }));
    await screen.findByText("Someone just took that number. Pick another one from the list.");
    expect(states()[0]).toBe("now");
    await waitFor(() => expect(a.search).toHaveBeenCalledTimes(2));
  });

  it("the other refusals each have a sentence of ours (plan, paused, second step, email already used, down)", async () => {
    for (const [out, text] of [
      [{ ok: false, error: "unavailable", reason: "not_on_plan" }, "An extra number is on paid plans. Your first number is included in every plan."],
      [{ ok: false, error: "step_up" }, "Sign in again with your second code, then pick the number."],
      [{ ok: false, error: "refused", reason: "email_in_use" }, "That e-mail address is already used for another phone-service account. Please contact us."],
      [{ ok: false, error: "down" }, "We could not look up numbers just now. Try again in a minute."],
    ] as const) {
      cleanup();
      await toStep4(buyActions({ buy: out as BuyAnswer }));
      fireEvent.click(screen.getByRole("checkbox"));
      fireEvent.click(screen.getByRole("button", { name: "Confirm and get this number" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(text);
    }
  });

  it("an admin can look but not buy", async () => {
    await toStep4(buyActions(), false);
    expect(screen.queryByRole("button", { name: "Confirm and get this number" })).toBeNull();
    expect(screen.getByText("Only the owner can pick the number.")).toBeInTheDocument();
  });
});

const STATUS = (over: Partial<KycStatus> = {}): KycStatus => ({ state: "created", accountType: "individual", step: null, steps: {}, missing: [], reason: null, ...over });
const OWN: OwnNumber = { ...N("+919429492465"), state: "calls_off", label: null };
const verifyActions = (over: Partial<VerifyActions> = {}): VerifyActions => ({
  status: vi.fn(async () => null),
  start: vi.fn(async () => ({ ok: true as const, data: STATUS() })),
  details: vi.fn(async () => ({ ok: true as const, data: STATUS({ state: "in_progress", step: "pan" }) })),
  pan: vi.fn(async () => ({ ok: true as const, data: STATUS({ state: "in_progress", step: "pan" }) })),
  gst: vi.fn(async () => ({ ok: true as const, data: STATUS({ state: "in_progress" }) })),
  aadhaar: vi.fn(async () => ({ ok: true as const, data: { url: "https://digilocker.example/x" } })),
  submit: vi.fn(async () => ({ ok: true as const, data: STATUS({ state: "submitted" }) })),
  uploadUrl: "/up",
  ...over,
});
const drawVerify = (status: KycStatus, a = verifyActions(), own: OwnNumber | null = OWN, canEdit = true) => render(<VerifyBusiness words={WORDS} status={status} own={own} canEdit={canEdit} actions={a} buyHref="/b?buy=1" />);
const chip = () => document.querySelector('[data-part="verify-chip"]')?.getAttribute("data-chip");
const vstates = () => [...document.querySelectorAll("[data-step]")].map((e) => e.getAttribute("data-state-of"));

describe("Verify your business: where it stands", () => {
  it("number chosen and account done, now the PAN and Aadhaar step, the last one waits; one orange line says calls cannot be made yet", () => {
    const { container } = drawVerify(STATUS({ state: "created" }));
    expect([...document.querySelectorAll("[data-step] h2")].map((e) => e.textContent?.replace(" ✓", ""))).toEqual(["Number chosen", "Calling account", "Verify with PAN and Aadhaar", "Ready to call"]);
    expect(vstates()).toEqual(["done", "done", "now", "off"]);
    expect(document.querySelector('[data-part="verify-note"]')).toHaveTextContent("This number cannot make calls until you finish. Calls to it are answered already.");
    expect(step(1)).toHaveTextContent("+91 94294 92465 is yours.");
    expect(chip()).toBe("waiting");
    expect(screen.getByText("Waiting for you")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/₹|price/i);
    expectNoSentenceForm(container);
  });
  it("submitted: we are checking it (the last step in hand); verified: all done, no warning", () => {
    drawVerify(STATUS({ state: "submitted", step: "complete" }));
    expect(vstates()).toEqual(["done", "done", "done", "now"]);
    expect(chip()).toBe("checking");
    expect(screen.getByText("We are checking it. This page updates by itself.")).toBeInTheDocument();
    cleanup();
    drawVerify(STATUS({ state: "verified" }));
    expect(vstates()).toEqual(["done", "done", "done", "done"]);
    expect(chip()).toBe("done");
    expect(document.querySelector('[data-part="verify-note"]')).toHaveTextContent("Your business is verified.");
  });
  it("stuck: our team has been told, in one sentence; nothing to press", () => {
    drawVerify(STATUS({ state: "stuck" }));
    expect(chip()).toBe("stuck");
    expect(document.querySelector('[data-part="stuck"]')).toHaveTextContent("We could not finish. Our team has been told; your details are kept as they were.");
  });
  it("no number yet and nothing started: choose the account type, Start verification, and a link to choose a number", async () => {
    const a = verifyActions();
    drawVerify(STATUS({ state: "not_started", accountType: null }), a, null);
    expect(document.querySelector('[data-part="verify-note"]')).toHaveTextContent("Do this first, then choose your number. It takes about five minutes.");
    expect(screen.getAllByRole("link", { name: "Choose a number" })[0]).toHaveAttribute("href", "/b?buy=1");
    fireEvent.click(screen.getByRole("button", { name: "Business" }));
    fireEvent.click(screen.getByRole("button", { name: "Start verification" }));
    await waitFor(() => expect(a.start).toHaveBeenCalledWith("business"));
  });
  it("Start verification opens the details (the name from step 2 of the buy page is already there); a business is asked its name and, later, the GST", () => {
    window.sessionStorage.setItem(PREFILL_KEY, JSON.stringify({ accountType: "individual", fullName: "Asha Rao" }));
    drawVerify(STATUS({ state: "created" }));
    expect(screen.getByLabelText("Full name")).toHaveValue("Asha Rao");
    expect(screen.queryByLabelText("Business name")).toBeNull();
    expect(screen.getByRole("button", { name: "Save and continue" })).toBeDisabled();
    cleanup();
    drawVerify(STATUS({ state: "created", accountType: "business" }));
    expect(screen.getByLabelText("Business name")).toBeInTheDocument();
  });
  it("the details form sends the real fields with the terms ticked", async () => {
    const a = verifyActions();
    drawVerify(STATUS({ state: "created" }), a);
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Asha Rao" } });
    fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "+91 98765 43210" } });
    fireEvent.change(screen.getByLabelText("Billing address"), { target: { value: "12 Main Road, Anantapur" } });
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Anantapur" } });
    fireEvent.change(screen.getByLabelText("State"), { target: { value: "Andhra Pradesh" } });
    fireEvent.change(screen.getByLabelText("PIN code"), { target: { value: "5150ab01" } });
    fireEvent.click(document.querySelector('input[type="checkbox"]') as HTMLElement);
    fireEvent.click(screen.getByText("Save and continue"));
    await waitFor(() => expect(a.details).toHaveBeenCalledWith({ accountType: "individual", businessName: "", fullName: "Asha Rao", phone: "+91 98765 43210", billingAddress: "12 Main Road, Anantapur", city: "Anantapur", state: "Andhra Pradesh", pincode: "515001", acceptTerms: true }));
    await waitFor(() => expect(document.querySelector('[data-doc="pan"]')).not.toBeNull()); // a plain selector: a role query over the whole page is what made this test slow
  });
});

describe("Verify your business: the documents", () => {
  const file = (name = "pan.png", type = "image/png") => new File([new Uint8Array([1, 2, 3])], name, { type });
  it("PAN: the number is checked first, then the file goes; PAN and the name on the card are asked as plain fields", async () => {
    const a = verifyActions();
    const up = vi.fn(async () => ({ json: async () => ({ ok: true, data: STATUS({ state: "in_progress", steps: { pan: true, aadhaar: false } }) }) }));
    vi.stubGlobal("fetch", up);
    const { container } = drawVerify(STATUS({ state: "in_progress", step: "pan", steps: { pan: false, aadhaar: false } }), a);
    expectNoSentenceForm(container);
    const send = screen.getByRole("button", { name: "Send" });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText("PAN number"), { target: { value: "abcde1234f" } });
    fireEvent.change(screen.getByLabelText("Name on the PAN card"), { target: { value: "Asha Rao" } });
    fireEvent.change(screen.getByLabelText("PAN card photo or PDF"), { target: { files: [file()] } });
    fireEvent.click(send);
    await waitFor(() => expect(a.pan).toHaveBeenCalledWith("ABCDE1234F", "Asha Rao"));
    await waitFor(() => expect(up).toHaveBeenCalledWith("/up", expect.objectContaining({ method: "POST" })));
    await waitFor(() => expect(document.querySelector('[data-doc="pan"]')).toHaveAttribute("data-done"));
    expect(document.querySelector('[data-doc="aadhaar"]')?.querySelector('[data-part="doc-aadhaar"]')).not.toBeNull();
    vi.unstubAllGlobals();
  });
  it("a PAN that does not match: the sentence, 'type it exactly as on the card'; no file is sent", async () => {
    const a = verifyActions({ pan: vi.fn(async () => ({ ok: false as const, error: "refused" as const, reason: "pan_mismatch" as const })) });
    const up = vi.fn();
    vi.stubGlobal("fetch", up);
    drawVerify(STATUS({ state: "in_progress", step: "pan" }), a);
    fireEvent.change(screen.getByLabelText("PAN number"), { target: { value: "ABCDE1234F" } });
    fireEvent.change(screen.getByLabelText("Name on the PAN card"), { target: { value: "Asha" } });
    fireEvent.change(screen.getByLabelText("PAN card photo or PDF"), { target: { files: [file()] } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The name does not match the PAN card. Type it exactly as on the card.");
    expect(up).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
  it("a file over 10 MB or of the wrong kind is refused here, in words, before anything is sent", async () => {
    vi.stubGlobal("fetch", vi.fn());
    drawVerify(STATUS({ state: "in_progress", step: "pan" }));
    fireEvent.change(screen.getByLabelText("PAN number"), { target: { value: "ABCDE1234F" } });
    fireEvent.change(screen.getByLabelText("Name on the PAN card"), { target: { value: "Asha Rao" } });
    const big = new File([new Uint8Array(1)], "big.pdf", { type: "application/pdf" });
    Object.defineProperty(big, "size", { value: 11 * 1024 * 1024 });
    fireEvent.change(screen.getByLabelText("PAN card photo or PDF"), { target: { files: [big] } });
    expect(await screen.findByText("That file is bigger than 10 MB.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("PAN card photo or PDF"), { target: { files: [file("a.gif", "image/gif")] } });
    expect(await screen.findByText("Choose a photo (JPEG or PNG) or a PDF.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
  it("Aadhaar: a DigiLocker link to open on your OWN phone ('it is you who confirms it, not us'), then the file", async () => {
    const a = verifyActions();
    drawVerify(STATUS({ state: "in_progress", step: "aadhaar", steps: { pan: true, aadhaar: false } }), a);
    expect(screen.getByText("Aadhaar is checked through DigiLocker. Open the link on your own phone: it is you who confirms it, not us.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Aadhaar file (photo or PDF)")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Get the DigiLocker link" }));
    const link = await screen.findByRole("link", { name: "Open the DigiLocker link" });
    expect(link).toHaveAttribute("href", "https://digilocker.example/x");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByLabelText("Aadhaar file (photo or PDF)")).toBeInTheDocument();
  });
  it("a business also gives the GST number and certificate; with every document in, 'Send for checking'; a document still missing is named", async () => {
    const a = verifyActions({ submit: vi.fn(async () => ({ ok: false as const, error: "refused" as const, reason: "missing_documents" as const, missing: ["GST Certificate"] })) });
    drawVerify(STATUS({ state: "in_progress", accountType: "business", step: "gst", steps: { pan: true, aadhaar: true, gst: false } }), a);
    expect(document.querySelector('[data-doc="gst"] [data-part="doc-gst"]')).not.toBeNull();
    expect(screen.getByLabelText("GST number")).toBeInTheDocument();
    cleanup();
    drawVerify(STATUS({ state: "in_progress", accountType: "business", step: "complete", steps: { pan: true, aadhaar: true, gst: true } }), a);
    fireEvent.click(screen.getByRole("button", { name: "Send for checking" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Some documents are still missing.");
    expect(alert).toHaveTextContent("Still missing: GST Certificate.");
  });
  it("says that the documents are not kept", () => {
    drawVerify(STATUS({ state: "in_progress", step: "pan" }));
    expect(screen.getByText("Your documents go to the phone service to be checked. We do not keep them or your PAN and GST numbers.")).toBeInTheDocument();
  });
  it("an admin sees where it stands but has no buttons that change anything", () => {
    drawVerify(STATUS({ state: "created" }), verifyActions(), OWN, false);
    expect(screen.queryByRole("button", { name: "Start verification" })).toBeNull();
    expect(screen.getByText("Only the owner can pick the number.")).toBeInTheDocument();
  });
});

describe("Get a phone number: step 3 offers Verify now, on this page (owner, 26 Nov 2026)", () => {
  const toStep3 = async (kyc: { status: KycStatus; actions: VerifyActions } | null, first = false) => {
    const out = render(<PhoneBuy words={WORDS} actions={buyActions()} canEdit email="asha@shop.in" verifyHref="/v?verify=1" kyc={kyc} kycFirst={first} />);
    await screen.findByText("+91 94294 92465");
    fireEvent.click(screen.getAllByRole("radio")[0]);
    fireEvent.click(screen.getByRole("button", { name: "Use this number" }));
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Asha Rao" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    return out;
  };
  it("two plain choices, Verify now (recommended) first and chosen; Continue waits until you are verified", async () => {
    const { container } = await toStep3({ status: STATUS({ state: "not_started", accountType: null }), actions: verifyActions() });
    const choice = document.querySelector('[data-part="verify-choice"]') as HTMLElement;
    const radios = within(choice).getAllByRole("radio");
    expect(radios).toHaveLength(2);
    expect(radios[0]).toBeChecked();
    expect(choice).toHaveTextContent("Verify now");
    expect(choice).toHaveTextContent("Recommended");
    expect(choice).toHaveTextContent("Verify after buying");
    expect(screen.getByRole("button", { name: "Start verification" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(screen.getByText("Continue opens when you are verified.")).toBeInTheDocument();
    expectNoSentenceForm(container);
  });
  it("Start verification opens the account with the type chosen in step 2, then the details form, on this page (no reload)", async () => {
    const actions = verifyActions();
    await toStep3({ status: STATUS({ state: "not_started", accountType: null }), actions });
    fireEvent.click(screen.getByRole("button", { name: "Start verification" }));
    await waitFor(() => expect(actions.start).toHaveBeenCalledWith("individual"));
    expect(await screen.findByLabelText("Phone number")).toBeInTheDocument();
    expect(nav.refresh).not.toHaveBeenCalled();
  });
  it("when the check says verified, Continue opens and the last step follows", async () => {
    await toStep3({ status: STATUS({ state: "verified" }), actions: verifyActions() });
    expect(screen.getByText("You are verified. Go on to the last step.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(states()).toEqual(["done", "done", "done", "now"]);
  });
  it("Verify after buying is the old text and Continue is open at once", async () => {
    await toStep3({ status: STATUS({ state: "not_started", accountType: null }), actions: verifyActions() });
    const choice = document.querySelector('[data-part="verify-choice"]') as HTMLElement;
    fireEvent.click(within(choice).getAllByRole("radio")[1]);
    expect(screen.queryByRole("button", { name: "Start verification" })).toBeNull();
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  });
  it("without the verification pieces (an API without them) step 3 only says that you verify after buying", async () => {
    await toStep3(null);
    expect(document.querySelector('[data-part="verify-choice"]')).toBeNull();
    expect(screen.getByText("You verify yourself after you buy.")).toBeInTheDocument();
  });
});

describe("Verify with PAN and Aadhaar: every field is mandatory (owner, 26 Nov 2026)", () => {
  const fill = (over: Record<string, string> = {}) => {
    const v = { "Full name": "Asha Rao", "Phone number": "98765 43210", "Billing address": "12 Main Road, Anantapur", City: "Anantapur", State: "Andhra Pradesh", "PIN code": "515001", ...over };
    for (const [label, value] of Object.entries(v)) fireEvent.change(screen.getByLabelText(label), { target: { value } });
  };
  it("each field says Required and is required; Save and continue stays off until all is valid; the state is a list of the 28 states and 8 territories", () => {
    drawVerify(STATUS({ state: "created" }));
    const form = document.querySelector('[data-part="details"]') as HTMLElement;
    for (const label of ["Full name", "Phone number", "Billing address", "City", "State", "PIN code"]) {
      expect(screen.getByLabelText(label)).toBeRequired();
      expect(screen.getByLabelText(label)).toHaveAttribute("aria-required", "true");
    }
    expect(within(form).getAllByText("Required").length).toBeGreaterThanOrEqual(6);
    const state = screen.getByLabelText("State") as HTMLSelectElement;
    expect(state.tagName).toBe("SELECT");
    expect(within(state).getAllByRole("option")).toHaveLength(37); // the prompt and 36
    fill();
    expect(screen.getByRole("button", { name: "Save and continue" })).toBeDisabled(); // the terms
    fireEvent.click(document.querySelector('input[type="checkbox"]') as HTMLElement);
    expect(screen.getByRole("button", { name: "Save and continue" })).toBeEnabled();
  });
  it("a plain sentence under a field once it was touched; the typed values stay; no red alert wall", () => {
    drawVerify(STATUS({ state: "created" }));
    fill({ "Phone number": "12345", "PIN code": "012345" });
    expect(screen.queryByText(/mobile number/)).toBeNull(); // not touched yet
    fireEvent.blur(screen.getByLabelText("Phone number"));
    fireEvent.blur(screen.getByLabelText("PIN code"));
    expect(screen.getByText("Write a 10-digit mobile number that starts with 6, 7, 8 or 9. +91 or 0 in front is fine.")).toBeInTheDocument();
    expect(screen.getByText("Write the PIN code: exactly 6 digits, the first one not 0.")).toBeInTheDocument();
    expect(screen.getByLabelText("Phone number")).toHaveValue("12345");
    expect(screen.getByLabelText("Phone number")).toHaveAttribute("aria-invalid", "true");
    expect(document.querySelector('[data-part="details"] [role="alert"]')).toBeNull();
    fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "+91 98765-43210" } });
    expect(screen.queryByText(/10-digit mobile number/)).toBeNull();
  });
  it("the API's own word for a bad field (kyc_fields_invalid) is said under that field with the same sentence, until the field is changed", async () => {
    const a = verifyActions({ details: vi.fn(async () => ({ ok: false as const, error: "invalid" as const, fieldReasons: { phone: "mobile_invalid", pincode: "pincode_invalid" } })) });
    drawVerify(STATUS({ state: "created" }), a);
    fill();
    fireEvent.click(document.querySelector('input[type="checkbox"]') as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    expect(await screen.findByText("Write a 10-digit mobile number that starts with 6, 7, 8 or 9. +91 or 0 in front is fine.")).toBeInTheDocument();
    expect(screen.getByLabelText("Full name")).toHaveValue("Asha Rao");
    fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "98765 43211" } });
    expect(screen.queryByText(/10-digit mobile number/)).toBeNull();
    expect(screen.getByText("Write the PIN code: exactly 6 digits, the first one not 0.")).toBeInTheDocument();
  });
  it("PAN and GST: the shape is checked as typed, a GST number only for a business", () => {
    drawVerify(STATUS({ state: "in_progress", step: "pan", steps: { pan: false, aadhaar: false } }));
    expect(screen.getByLabelText("PAN number")).toBeRequired();
    fireEvent.change(screen.getByLabelText("PAN number"), { target: { value: "ABCDE12" } });
    fireEvent.blur(screen.getByLabelText("PAN number"));
    expect(screen.getByText("A PAN has 5 letters, 4 digits and 1 letter, for example ABCDE1234F.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    cleanup();
    drawVerify(STATUS({ state: "in_progress", accountType: "business", step: "gst", steps: { pan: true, aadhaar: true, gst: false } }));
    fireEvent.change(screen.getByLabelText("GST number"), { target: { value: "99ABCDE1234F1Z5" } });
    fireEvent.blur(screen.getByLabelText("GST number"));
    expect(screen.getByText("A GST number has 15 characters, for example 36ABCDE1234F1Z5.")).toBeInTheDocument();
  });
});

describe("Get a phone number: verification first, then buy (owner, 26 Nov 2026)", () => {
  const toStep3 = async (status: KycStatus) => {
    render(<PhoneBuy words={WORDS} actions={buyActions()} canEdit email="asha@shop.in" verifyHref="/v?verify=1" kyc={{ status, actions: verifyActions() }} kycFirst />);
    await screen.findByText("+91 94294 92465");
    fireEvent.click(screen.getAllByRole("radio")[0]);
    fireEvent.click(screen.getByRole("button", { name: "Use this number" }));
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Asha Rao" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  };
  it("step 3 is only the verification: no choice, no 'after buying', one sentence about what works before it", async () => {
    await toStep3(STATUS({ state: "not_started", accountType: null }));
    expect(document.querySelector('[data-part="verify-choice"]')).toBeNull();
    expect(screen.queryByText("Verify after buying")).toBeNull();
    expect(document.querySelector('[data-part="free-things"]')).toHaveTextContent("browser test call");
    expect(screen.getByRole("button", { name: "Start verification" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });
  it("the Buy button opens only when the status is verified", async () => {
    await toStep3(STATUS({ state: "verified" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(states()).toEqual(["done", "done", "done", "now"]);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(document.querySelector('[data-part="confirm"]')).toBeEnabled();
  });
  it("while the phone service has no free line the page says so as a friendly wait, not an error", async () => {
    await toStep3(STATUS({ state: "waiting_for_line" as KycStatus["state"] }));
    expect(document.querySelector('[data-part="waiting-line"]')).toHaveTextContent("We are setting up your line. This takes a short while.");
    expect(document.querySelector('[data-part="verify-error"]')).toBeNull();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });
});

describe("the PIN code fills the state and the city (VoiceLink knows a city only as its own list spells it)", () => {
  it("a complete PIN fills State and City; the person can correct them; a field the person typed is not overwritten", async () => {
    const pin = vi.fn(async () => ({ state: "Andhra Pradesh", city: "Ananthapuramu" }));
    drawVerify(STATUS({ state: "created" }), verifyActions({ pin }));
    fireEvent.change(screen.getByLabelText("PIN code"), { target: { value: "515001" } });
    await waitFor(() => expect(screen.getByLabelText("City")).toHaveValue("Ananthapuramu"));
    expect(screen.getByLabelText("State")).toHaveValue("Andhra Pradesh");
    expect(screen.getByText("State and city are filled in from the PIN. Change them if they are wrong.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Dharmavaram" } });
    fireEvent.change(screen.getByLabelText("PIN code"), { target: { value: "515002" } });
    await waitFor(() => expect(pin).toHaveBeenCalledWith("515002"));
    expect(screen.getByLabelText("City")).toHaveValue("Dharmavaram");
    expect(pin).not.toHaveBeenCalledWith("51500");
  });
  it("no answer from the directory: nothing is filled and the person types the two fields", async () => {
    const pin = vi.fn(async () => null);
    drawVerify(STATUS({ state: "created" }), verifyActions({ pin }));
    fireEvent.change(screen.getByLabelText("PIN code"), { target: { value: "515001" } });
    await waitFor(() => expect(pin).toHaveBeenCalled());
    expect(screen.getByLabelText("City")).toHaveValue("");
    expect(screen.queryByText(/filled in from the PIN/)).toBeNull();
  });
  it("the phone service's city refusal says: pick the city name as your post office writes it, under City", async () => {
    const a = verifyActions({ details: vi.fn(async () => ({ ok: false as const, error: "invalid" as const, fieldReasons: { city: "city_not_found" } })) });
    drawVerify(STATUS({ state: "created" }), a);
    for (const [label, value] of Object.entries({ "Full name": "Asha Rao", "Phone number": "98765 43210", "Billing address": "12 Main Road, Anantapur", City: "Anantapur", State: "Andhra Pradesh", "PIN code": "515001" })) fireEvent.change(screen.getByLabelText(label), { target: { value } });
    fireEvent.click(document.querySelector('input[type="checkbox"]') as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    expect(await screen.findByText("Pick the city name as your post office writes it.")).toBeInTheDocument();
    expect(screen.getByLabelText("City")).toHaveValue("Anantapur");
  });
});
