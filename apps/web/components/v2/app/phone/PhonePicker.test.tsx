import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appDict } from "@/i18n/app";
import type { ClaimResult, OwnNumber, SearchResult } from "@/lib/phone-picker/types";

import { PhonePicker } from "./PhonePicker";

const WORDS = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("pick.") || k.startsWith("phn.kyc.")));
const N = (n: string) => ({ number: n, display: `+91 ${n.slice(3, 8)} ${n.slice(8)}`, type: "mobile" as const });
const LIST: SearchResult = { ok: true, numbers: [N("+919429492465"), N("+919429492466")], page: 1, more: false };
const MINE = (state: OwnNumber["state"]): OwnNumber => ({ ...N("+919429492465"), state, label: null });
const actions = (over: Partial<{ search: SearchResult; claim: ClaimResult; poll: OwnNumber | null }> = {}) => ({
  search: vi.fn(async () => over.search ?? LIST),
  claim: vi.fn(async () => over.claim ?? { ok: true as const, number: MINE("getting_ready") }),
  poll: vi.fn(async () => over.poll ?? null),
});
afterEach(cleanup);

describe("a number that waits for the business to be verified (kyc_pending)", () => {
  it("shows the neutral notice with the Verify link, hides the forwarding steps and keeps asking until it is active", async () => {
    const a = actions({ poll: MINE("ready") });
    vi.useFakeTimers();
    render(<PhonePicker words={WORDS} actions={a} own={MINE("kyc_pending")} canEdit verifyHref="/v?verify=1" />);
    expect(screen.getByRole("status")).toHaveTextContent("Your number is not active until your business is verified.");
    expect(screen.getByRole("link", { name: "Verify now." })).toHaveAttribute("href", "/v?verify=1");
    expect(document.querySelector('[data-part="forwarding"]')).toBeNull();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(a.poll).toHaveBeenCalled();
    vi.useRealTimers();
    await waitFor(() => expect(document.querySelector('[data-part="forwarding"]')).not.toBeNull());
    expect(screen.queryByRole("link", { name: "Verify now." })).toBeNull();
  });
});

describe("the number picker", () => {
  it("is three plain steps; step 1 is open, the others one grey line, and there is no price anywhere", () => {
    const { container } = render(<PhonePicker words={WORDS} actions={actions()} own={null} canEdit />);
    expect([...container.querySelectorAll("[data-step]")].map((e) => e.getAttribute("data-state-of"))).toEqual(["now", "off", "off"]);
    expect(container.textContent).not.toMatch(/₹|Rs\.?\s?\d|price/i);
    expect(screen.getByRole("button", { name: "Use this number" })).toBeDisabled();
  });

  it("searches, lists the numbers as +91 XXXXX XXXXX radio rows, picks the first, and claims it with ONE orange button", async () => {
    const a = actions();
    render(<PhonePicker words={WORDS} actions={a} own={null} canEdit />);
    fireEvent.change(screen.getByLabelText("Starts with (optional)"), { target: { value: "94" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await screen.findByText("+91 94294 92465");
    expect(a.search).toHaveBeenCalledWith("mobile", "94", 1);
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect(screen.getAllByRole("radio")[0]).toBeChecked();
    fireEvent.click(screen.getAllByRole("radio")[1]);
    fireEvent.click(screen.getByRole("button", { name: "Use this number" }));
    await waitFor(() => expect(a.claim).toHaveBeenCalledWith("+919429492466", "mobile"));
    await screen.findByText(/We are connecting/);
    expect(document.querySelector('[data-part="my-number"]')).toHaveTextContent("+91 94294 92465");
  });

  it("says so in plain words when no number matches, when it is taken, and when the picker is off for the plan", async () => {
    const none = actions({ search: { ok: true, numbers: [], page: 1, more: false } });
    const { unmount } = render(<PhonePicker words={WORDS} actions={none} own={null} canEdit />);
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await screen.findByText("No number starts with that. Try fewer digits.");
    unmount();
    const plan = actions({ search: { ok: false, error: "unavailable", reason: "not_on_plan" } });
    render(<PhonePicker words={WORDS} actions={plan} own={null} canEdit />);
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await screen.findByText("An extra number is on paid plans. Your first number is included in every plan.");
  });

  it("a number someone just took: the sentence, and the list is asked again", async () => {
    const a = actions({ claim: { ok: false, error: "taken" } });
    render(<PhonePicker words={WORDS} actions={a} own={null} canEdit />);
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await screen.findByText("+91 94294 92465");
    fireEvent.click(screen.getByRole("button", { name: "Use this number" }));
    await screen.findByText("Someone just took that number. Pick another one from the list.");
    await waitFor(() => expect(a.search).toHaveBeenCalledTimes(2));
  });

  it("once the number is ready, step 3 shows the code for the phone company (Jio: where to look, no made-up code)", async () => {
    render(<PhonePicker words={WORDS} actions={actions()} own={MINE("ready")} canEdit />);
    expect(document.querySelector('[data-part="code-on"]')).toHaveTextContent("**61*+919429492465#");
    fireEvent.change(screen.getByLabelText("Your phone company"), { target: { value: "jio" } });
    expect(document.querySelector('[data-part="code-on"]')).toBeNull();
    expect(document.querySelector('[data-part="code-none"]')).not.toBeNull();
  });

  it("an admin can look but not claim", () => {
    render(<PhonePicker words={WORDS} actions={actions()} own={null} canEdit={false} />);
    expect(screen.queryByRole("button", { name: "Use this number" })).toBeNull();
    expect(screen.getByText("Only the owner can pick the number.")).toBeInTheDocument();
  });
});
