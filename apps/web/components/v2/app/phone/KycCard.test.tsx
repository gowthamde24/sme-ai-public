import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appDict } from "@/i18n/app";
import { KYC_STATES, type KycBody, type KycOptions, type KycReply, type KycState, type KycStatus } from "@/lib/phone-kyc/types";

import { stepHref } from "../today/v6/day-one/steps";
import { KycCard } from "./KycCard";
import { PhoneV6 } from "./PhoneV6";

vi.mock("../ds/LazyFileField", async () => ({ LazyFileField: (await import("../ds/FileField")).FileField }));
afterEach(cleanup);
const WORDS = appDict("en") as Record<string, string>;
const K = "33333333-3333-4333-8333-333333333333";
const status = (state: KycState, over: Partial<KycStatus> = {}): KycStatus => ({ state, kycId: null, docKind: null, complianceId: null, reason: null, createdAt: null, updatedAt: null, checkedAt: null, live: true, canChooseNumber: false, ...over });
const OPTIONS: KycOptions = {
  live: true,
  documents: [
    { kind: "gst", numberLabel: "GSTIN", numberExample: "36ABCDE1234F1Z5" },
    { kind: "udyam", numberLabel: "Udyam registration number", numberExample: "UDYAM-TS-02-0000001" },
    { kind: "coi", numberLabel: "CIN / LLPIN", numberExample: "U12345TG2020PTC123456" },
  ],
  maxFileBytes: 5_000_000,
  fileTypes: ["application/pdf", "image/jpeg", "image/png"],
  keptNote: "",
};
type Send = (b: KycBody) => Promise<KycReply>;
const show = (s: KycStatus | null, over: { options?: KycOptions | null; canEdit?: boolean; send?: Send; defaultEmail?: string } = {}) =>
  render(<KycCard words={WORDS} status={s} options={over.options === undefined ? OPTIONS : over.options} canEdit={over.canEdit ?? true} endpoint="/app/tenants/t1/phone-kyc" defaultEmail={over.defaultEmail} send={over.send} />);
const card = () => document.querySelector('[data-part="phone-kyc-card"]') as HTMLElement;
const pdf = (name = "gst.pdf", bytes = 12) => new File([new Uint8Array(bytes).fill(37)], name, { type: "application/pdf" });
const type = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
function fill(over: Record<string, string> = {}) {
  const v = { number: "36ABCDE1234F1Z5", legal: "Demo Silks Pvt Ltd", email: "owner@example.test", addr1: "1 Main Road", city: "Hyderabad", state: "Telangana", postal: "500001", ...over };
  type(/^(GSTIN|Udyam registration number|CIN \/ LLPIN)$/, v.number);
  type("Business name", v.legal);
  type("E-mail", v.email);
  type("Address", v.addr1);
  type("City", v.city);
  type("State", v.state);
  type("PIN code", v.postal);
}
const choose = (f: File) => fireEvent.change(screen.getByLabelText("Your document"), { target: { files: [f] } });
const press = async (name = "Send for registration") => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
    await new Promise((r) => setTimeout(r, 60)); // FileReader answers on a later turn of the event loop
  });
};

describe("the registration card: each state in plain words", () => {
  const WORDS_OF: Record<KycState, [string, string]> = {
    not_started: ["Not registered yet", "Before you can choose a phone number"],
    preparing: ["Being checked", "they are checking them"],
    submitted: ["Being checked", "they are checking them"],
    accepted: ["Registered", "Your business is registered; you can choose your number now."],
    rejected: ["Not accepted", "The phone company did not accept it."],
    failed: ["Not sent", "It was not sent."],
    suspended: ["Paused", "has paused your registration"],
    expired: ["Expired", "has run out"],
  };
  it.each(KYC_STATES)("says %s", (state) => {
    show(status(state));
    expect(card()).toHaveAttribute("data-kyc-state", state);
    expect(within(card()).getByText(WORDS_OF[state][0])).toBeInTheDocument();
    expect(card()).toHaveTextContent(WORDS_OF[state][1]);
  });
  it("the pill colours follow the kit: grey, blue, green, red, orange", () => {
    const pill = (s: KycState) => {
      cleanup();
      show(status(s));
      return card().querySelector("[data-status]")?.getAttribute("data-status");
    };
    expect([pill("not_started"), pill("submitted"), pill("accepted"), pill("rejected"), pill("suspended")]).toEqual(["no_answer", "transferred", "completed", "rejected", "spam"]);
  });
  it("shows a part it could not read as 'being set up', without a form", () => {
    show(null);
    expect(card()).toHaveAttribute("data-kyc-state", "unavailable");
    expect(within(card()).getByText("Being set up")).toBeInTheDocument();
    expect(card()).toHaveTextContent("is being set up");
    expect(document.querySelector('[data-part="kyc-form"]')).toBeNull();
  });
  it("test mode (live false) says nothing is sent to the phone company", () => {
    show(status("not_started", { live: false }));
    expect(document.querySelector('[data-part="kyc-testmode"]')).toHaveTextContent("Test mode: nothing is sent to the phone company.");
    cleanup();
    show(status("not_started", { live: true }));
    expect(document.querySelector('[data-part="kyc-testmode"]')).toBeNull();
  });
  it("a rejection shows the phone company's own words as plain text, and the button says 'Fix and send again'", () => {
    show(status("rejected", { reason: "The GSTIN <b>is not active</b>." }));
    const reason = document.querySelector('[data-part="kyc-reason"]') as HTMLElement;
    expect(reason).toHaveTextContent("The phone company says: The GSTIN <b>is not active</b>.");
    expect(reason.querySelector("b")).toBeNull();
    expect(screen.getByRole("button", { name: "Fix and send again" })).toBeInTheDocument();
  });
  it("being checked and registered have no form (a second filing would only confuse)", () => {
    for (const s of ["preparing", "submitted", "accepted"] as const) {
      cleanup();
      show(status(s));
      expect(document.querySelector('[data-part="kyc-form"]')).toBeNull();
    }
  });
  it("a suspended or expired registration can be sent again", () => {
    for (const s of ["suspended", "expired", "failed"] as const) {
      cleanup();
      show(status(s));
      expect(screen.getByRole("button", { name: "Fix and send again" })).toBeInTheDocument();
    }
  });
});

describe("who may send", () => {
  it("an Admin reads the state and the reason, and has no form and no button", () => {
    show(status("rejected", { reason: "The GSTIN is not active." }), { canEdit: false, options: null });
    expect(document.querySelector('[data-part="kyc-reason"]')).toHaveTextContent("The GSTIN is not active.");
    expect(document.querySelector('[data-part="kyc-form"]')).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(card()).toHaveTextContent("Only the owner can send the registration.");
  });
  it("an Owner whose documents could not be read sees the state and 'the form is being set up', not a broken form", () => {
    show(status("not_started"), { options: null });
    expect(document.querySelector('[data-part="kyc-form"]')).toBeNull();
    expect(card()).toHaveTextContent("The form is being set up.");
  });
});

describe("the form", () => {
  it("offers the documents as round radios, the first chosen; the number is labelled and exemplified by the API's words, and changes with the document", () => {
    show(status("not_started"), { defaultEmail: "owner@example.test" });
    const radios = within(card()).getAllByRole("radio");
    expect(radios.map((r) => (r as HTMLInputElement).value)).toEqual(["gst", "udyam", "coi"]);
    expect(radios.map((r) => r.getAttribute("type"))).toEqual(["radio", "radio", "radio"]);
    expect(radios[0]).toBeChecked();
    expect(screen.getByLabelText("GSTIN")).toBeInTheDocument();
    expect(card()).toHaveTextContent("For example 36ABCDE1234F1Z5");
    expect(screen.getByLabelText("E-mail")).toHaveValue("owner@example.test");
    fireEvent.click(radios[1]);
    expect(screen.getByLabelText("Udyam registration number")).toHaveValue("");
    expect(card()).toHaveTextContent("For example UDYAM-TS-02-0000001");
    fireEvent.click(radios[2]);
    expect(screen.getByLabelText("CIN / LLPIN")).toBeInTheDocument();
  });
  it("has ONE file choice (pdf, jpg, png), ONE primary button and the one-line note that nothing is kept", () => {
    show(status("not_started"));
    const file = screen.getByLabelText("Your document") as HTMLInputElement;
    expect(file.type).toBe("file");
    expect(file.accept).toContain("application/pdf");
    expect(document.querySelectorAll('input[type="file"]')).toHaveLength(1);
    expect(within(card()).getAllByRole("button")).toHaveLength(1);
    expect(document.querySelector('[data-part="kyc-kept"]')).toHaveTextContent("Your document goes to the phone company and is not kept by us.");
    expect(card()).toHaveTextContent("A PDF, JPG or PNG file, up to 5 MB.");
  });
  it("checks every field before sending: nothing is sent, each wrong field says why", async () => {
    const send = vi.fn<Send>();
    show(status("not_started"), { send });
    await press();
    expect(send).not.toHaveBeenCalled();
    expect(document.querySelector('[data-part="kyc-summary"]')).toHaveTextContent("Nothing was sent.");
    expect(screen.getByLabelText("GSTIN")).toHaveAttribute("aria-invalid", "true");
    expect(card()).toHaveTextContent("That does not look like a GSTIN. For example 36ABCDE1234F1Z5.");
    expect(card()).toHaveTextContent("The PIN code has 6 digits.");
    expect(card()).toHaveTextContent("Choose your document.");
    fill({ postal: "12345" });
    choose(pdf());
    await press();
    expect(card()).toHaveTextContent("The PIN code has 6 digits.");
    expect(send).not.toHaveBeenCalled();
  });
  it("checks the file's kind and size in the browser BEFORE reading it", () => {
    const read = vi.spyOn(FileReader.prototype, "readAsDataURL");
    show(status("not_started"));
    const big = pdf("big.pdf", 10);
    Object.defineProperty(big, "size", { value: 5_000_001 });
    choose(big);
    expect(card()).toHaveTextContent("That file is over 5 MB. Choose a smaller PDF or photo.");
    choose(new File(["x"], "notes.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
    expect(card()).toHaveTextContent("Choose a PDF, JPG or PNG file.");
    expect(read).not.toHaveBeenCalled();
    choose(pdf());
    expect(card()).not.toHaveTextContent("Choose a PDF, JPG or PNG file.");
    read.mockRestore();
  });
  it("is our own upload field (a drop area, no plain browser button), takes a dropped file and sends the same body; removing the file puts the 'Choose your document.' sentence back", async () => {
    const send = vi.fn<Send>().mockResolvedValue({ ok: true, data: status("submitted", { kycId: K }) });
    show(status("not_started"), { send });
    const zone = document.querySelector('[data-part="file-field"] label') as HTMLElement;
    expect(zone).toHaveTextContent("Drop your document here or choose a file");
    fill();
    fireEvent.drop(zone, { dataTransfer: { files: [pdf("gst.pdf")] } });
    expect(card()).toHaveTextContent("gst.pdf");
    fireEvent.click(screen.getByRole("button", { name: "Remove the file" }));
    await press();
    expect(send).not.toHaveBeenCalled();
    expect(card()).toHaveTextContent("Choose your document.");
    fireEvent.drop(zone, { dataTransfer: { files: [pdf("gst.pdf")] } });
    await press();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].document).toMatchObject({ name: "gst.pdf", content_type: "application/pdf", data_base64: btoa("%%%%%%%%%%%%") });
  });
  it("uses the API's own limit, not a fixed one", () => {
    show(status("not_started"), { options: { ...OPTIONS, maxFileBytes: 2_000_000 } });
    expect(card()).toHaveTextContent("up to 2 MB");
    const f = pdf("a.pdf", 10);
    Object.defineProperty(f, "size", { value: 2_000_001 });
    choose(f);
    expect(card()).toHaveTextContent("over 2 MB");
  });
});

describe("sending", () => {
  it("reads the file as base64 when the button is pressed and sends ONE body with a fresh attempt id; being checked then replaces the form", async () => {
    const send = vi.fn<Send>().mockResolvedValue({ ok: true, data: status("submitted", { kycId: K }) });
    show(status("not_started"), { send });
    fill({ number: "36abcde 1234f1z5" });
    choose(pdf("my gst.pdf", 3));
    await press();
    expect(send).toHaveBeenCalledTimes(1);
    const body = send.mock.calls[0][0];
    expect(body).toMatchObject({ doc_kind: "gst", legal_name: "Demo Silks Pvt Ltd", registration_number: "36ABCDE1234F1Z5", email: "owner@example.test", address_line1: "1 Main Road", address_line2: "", city: "Hyderabad", state: "Telangana", postal_code: "500001" });
    expect(body.kyc_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(body.document).toEqual({ name: "my gst.pdf", content_type: "application/pdf", data_base64: btoa("%%%") });
    await waitFor(() => expect(card()).toHaveAttribute("data-kyc-state", "submitted"));
    expect(document.querySelector('[data-part="kyc-form"]')).toBeNull();
    expect(document.querySelector('[data-part="kyc-said"]')).toHaveTextContent("Sent. The phone company is checking your details.");
  });
  it("in test mode the answer is 'checked, nothing sent' and the form stays", async () => {
    const send = vi.fn<Send>().mockResolvedValue({ ok: true, data: status("not_started", { live: false }) });
    show(status("not_started", { live: false }), { send });
    fill();
    choose(pdf());
    await press();
    await waitFor(() => expect(document.querySelector('[data-part="kyc-said"]')).toHaveTextContent("Test mode: nothing was sent to the phone company."));
    expect(document.querySelector('[data-part="kyc-form"]')).not.toBeNull();
  });
  it("a lost answer (the phone company did not answer, no network) is retried with the SAME attempt id, so it files once", async () => {
    const send = vi
      .fn<Send>()
      .mockResolvedValueOnce({ ok: false, kind: "unavailable", error: "The phone company did not answer. Wait a minute and press the button again; it will not be sent twice.", code: "kyc_provider_unavailable" })
      .mockResolvedValueOnce({ ok: false, kind: "unavailable", error: "" })
      .mockResolvedValueOnce({ ok: true, data: status("submitted") });
    show(status("not_started"), { send });
    fill();
    choose(pdf());
    await press();
    expect(document.querySelector('[data-part="kyc-failure"]')).toHaveTextContent("it will not be sent twice");
    await press();
    expect(document.querySelector('[data-part="kyc-failure"]')).toHaveTextContent("We could not reach the service"); // our sentence for 'unavailable' when the route could not be reached
    await press();
    const ids = send.mock.calls.map((c) => c[0].kyc_id);
    expect(new Set(ids).size).toBe(1);
  });
  it("after the phone company refused the filing as it is (413, 415, 422, 409) the next try is a NEW attempt, and the file or the details are still there to fix", async () => {
    const send = vi
      .fn<Send>()
      .mockResolvedValueOnce({ ok: false, kind: "invalid", error: "The phone company did not accept this. Check the document and the details, then send again.", code: "kyc_not_accepted", reason: "The GSTIN is not active." })
      .mockResolvedValueOnce({ ok: true, data: status("submitted") });
    show(status("not_started"), { send });
    fill();
    choose(pdf());
    await press();
    const alert = document.querySelector('[data-part="kyc-failure"]') as HTMLElement;
    expect(alert).toHaveTextContent("The phone company did not accept this.");
    expect(document.querySelector('[data-part="kyc-failure-reason"]')).toHaveTextContent("The phone company says: The GSTIN is not active.");
    expect(screen.getByLabelText("Business name")).toHaveValue("Demo Silks Pvt Ltd");
    type("Business name", "Demo Silks Private Limited");
    await press();
    expect(send.mock.calls[0][0].kyc_id).not.toBe(send.mock.calls[1][0].kyc_id);
    expect(send.mock.calls[1][0].legal_name).toBe("Demo Silks Private Limited");
  });
  it("says the 413 and 415 refusals in our words and marks the file", async () => {
    const send = vi.fn<Send>().mockResolvedValueOnce({ ok: false, kind: "too_big", error: "That file is over 5 MB. Choose a smaller PDF or photo.", code: "kyc_file_too_large" });
    show(status("not_started"), { send });
    fill();
    choose(pdf());
    await press();
    expect(document.querySelector('[data-part="kyc-failure"]')).toHaveTextContent("That file is over 5 MB. Choose a smaller PDF or photo.");
    expect(screen.getByLabelText("Your document")).toHaveAttribute("aria-invalid", "true");
  });
  it("a missing second step says so and gives the way to Security", async () => {
    const send = vi.fn<Send>().mockResolvedValue({ ok: false, kind: "mfa", error: "This needs your two-step code first. Sign in again and type the code, then try again.", mfa: true });
    show(status("not_started"), { send });
    fill();
    choose(pdf());
    await press();
    expect(within(document.querySelector('[data-part="kyc-failure"]') as HTMLElement).getByRole("link")).toHaveAttribute("href", "/app/security");
  });
  it("sends to our route as ONE JSON POST (not a server action) when no sender is given", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, data: status("submitted") }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    show(status("not_started"));
    fill();
    choose(pdf());
    await press();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/app/tenants/t1/phone-kyc");
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" } });
    expect(JSON.parse(init.body).document.data_base64).toBe(btoa("%%%%%%%%%%%%"));
    vi.unstubAllGlobals();
  });
  it("does not keep the file's bytes anywhere in the page after sending", async () => {
    const send = vi.fn<Send>().mockResolvedValue({ ok: true, data: status("submitted") });
    show(status("not_started"), { send });
    fill();
    choose(pdf());
    await press();
    expect(document.body.innerHTML).not.toContain(btoa("%%%%%%%%%%%%"));
  });
});

describe("in other languages", () => {
  beforeEach(() => undefined);
  it("draws the states in Telugu with the words the owner uses (English business words kept)", () => {
    const te = appDict("te") as Record<string, string>;
    render(<KycCard words={te} status={status("accepted")} options={OPTIONS} canEdit endpoint="/x" />);
    expect(card()).toHaveTextContent("రిజిస్టర్ అయింది");
    expect(card()).toHaveTextContent("మీ బిజినెస్ రిజిస్టర్ అయింది");
  });
});

describe("where the card is reached from", () => {
  it("Today's day-one step 'Connect your phone number' still opens the Phone number page, where the card is", () => {
    expect(stepHref("phone", "/app/tenants/T")).toBe("/app/tenants/T/phone-number");
  });
  it("the Phone number page draws the card above its own number card, and not at all when none is given (no JOBS or other flag involved)", () => {
    const base = { words: WORDS, lang: "en", title: "Phone number", help: <button type="button">?</button>, phone: null, panel: null, connectHref: "/x" };
    const { rerender } = render(<PhoneV6 {...base} kyc={<KycCard words={WORDS} status={status("not_started")} options={OPTIONS} canEdit endpoint="/x" />} />);
    const slot = document.querySelector('[data-part="kyc-slot"]') as HTMLElement;
    expect(slot.querySelector('[data-part="phone-kyc-card"]')).not.toBeNull();
    expect(slot.compareDocumentPosition(document.querySelector('[data-part="phone-status"]') as HTMLElement) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    rerender(<PhoneV6 {...base} />);
    expect(document.querySelector('[data-part="kyc-slot"]')).toBeNull();
  });
});
