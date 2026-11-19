import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { QuotePolicyVersion } from "@/lib/api/quote-policies";

import type { QuotePolicyState } from "./quote-policy-actions";
import { FIELD_TEXT } from "./quote-policy-logic";
import { QuotePolicyForm } from "./quote-policy-form";
import { QuotePolicyView } from "./quote-policy-view";

const fetchVersions = vi.fn();
const formProps = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(to); } }));
vi.mock("@/lib/packs/read", () => ({ readPackCached: async () => null }));
vi.mock("@/lib/api/quote-policies", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/quote-policies")>()), fetchQuotePolicyVersions: (...a: unknown[]) => fetchVersions(...a) }));
vi.mock("./quote-policy-actions", () => ({ publishQuotePolicyAction: vi.fn(async () => undefined) }));
vi.mock("./LazyQuotePolicyForm", () => ({
  QuotePolicyForm: (props: Record<string, unknown>) => {
    formProps(props);
    return <p>POLICY-FORM</p>;
  },
}));

import { QuotePolicySection } from "./quote-policy-section";

// Every number here is a SYNTHETIC placeholder for a test, not a suggestion and not the family's policy.
const ID = "55555555-5555-4555-8555-555555555555";
const T = "22222222-2222-4222-8222-222222222222";
const SAVED: QuotePolicyState = { ok: true, message: "Published version 3, starting on 20 Oct 2026." };
type Fn = (prev: QuotePolicyState, data: FormData) => Promise<QuotePolicyState>;
const form = (action: Fn, simple = true) => render(<QuotePolicyForm action={action} policyId={ID} today="2026-10-08" minDate="2026-10-12" simple={simple} />);
const GOOD = { effective_from: "2026-10-20", validity_days: "7", new_advance: "50", repeat_advance: "25.5", new_net_days: "10", repeat_net_days: "45", gst_rate: "5", credit_limit: "2500.50", seller_state: "XX", discount_ceiling: "0" };
const NAMES = Object.keys(GOOD) as (keyof typeof GOOD)[];
const byName = (name: string) => document.querySelector(`input[name="${name}"]`) as HTMLInputElement;
const fillAll = (over: Partial<typeof GOOD> = {}) => {
  for (const [k, v] of Object.entries({ ...GOOD, ...over })) fireEvent.change(byName(k), { target: { value: v } });
};
const submit = async () => act(async () => fireEvent.click(screen.getByRole("button", { name: /Publish this version|Publishing/ })));
afterEach(() => {
  cleanup();
  delete process.env.JOBS;
});
beforeEach(() => vi.clearAllMocks());

describe("Settings > Quotes under JOBS: the rules as sentences with the number inside", () => {
  it("every field starts empty; the first card has four choices, the second two, the rest is under More choices", () => {
    form(vi.fn<Fn>(async () => SAVED));
    for (const n of NAMES) expect(byName(n).value, n).toBe("");
    const main = document.querySelector('[data-part="quote-simple-main"]') as HTMLElement;
    expect([...main.querySelectorAll("input")].map((i) => i.getAttribute("name"))).toEqual(["effective_from", "validity_days", "new_advance", "repeat_advance"]);
    expect(document.querySelector('[data-part="quote-simple-balance"]')!.querySelectorAll("input")).toHaveLength(2);
    const more = document.querySelector('[data-part="more-choices"]') as HTMLElement;
    expect(more).not.toHaveAttribute("open");
    expect([...more.querySelectorAll("input")].map((i) => i.getAttribute("name"))).toEqual(["gst_rate", "credit_limit", "seller_state", "discount_ceiling"]);
    expect(screen.getByText(/A published version never changes/)).toBeInTheDocument();
    expect(screen.getByText("Shipping: none (no courier charge)")).toBeInTheDocument();
    expect(screen.getByText("What it will do:").parentElement).toHaveTextContent("Fill in the days, the advance and the days to pay to see what a quote will say.");
  });
  it("the effect line follows what is typed: the quote's last day and what a new customer pays", () => {
    form(vi.fn<Fn>(async () => SAVED));
    fillAll();
    expect(screen.getByText("What it will do:").parentElement).toHaveTextContent("A quote made on 20 Oct 2026 is valid until 27 Oct 2026. A new customer pays 50% in advance and the rest within 10 days.");
    fireEvent.change(byName("validity_days"), { target: { value: "15" } });
    expect(screen.getByText("What it will do:").parentElement).toHaveTextContent("valid until 4 Nov 2026");
  });
  it("sends the SAME FormData as the old form (same names, the page's id) and shows the saved sentence", async () => {
    const action = vi.fn<Fn>(async () => SAVED);
    form(action);
    fillAll();
    await submit();
    expect(action).toHaveBeenCalledTimes(1);
    const data = action.mock.calls[0][1];
    expect(Object.fromEntries(data.entries())).toEqual({ policy_id: ID, ...GOOD });
    expect(await screen.findByText("Published version 3, starting on 20 Oct 2026.")).toBeInTheDocument();
  });
  it("a missing or wrong field gets OUR sentence with no request; the browser's own bubbles stay off", async () => {
    const action = vi.fn<Fn>(async () => SAVED);
    form(action);
    fillAll({ validity_days: "0" });
    await submit();
    expect(screen.getByRole("alert")).toHaveTextContent(FIELD_TEXT.validity_days);
    expect(action).not.toHaveBeenCalled();
    expect(document.querySelector("form")).toHaveAttribute("novalidate");
  });
  it("a refusal for the two-step code keeps what was typed and points at the Security page", async () => {
    const action = vi.fn<Fn>(async () => ({ ok: false, error: "This needs your two-step code first.", reason: "mfa" }));
    form(action);
    fillAll();
    await submit();
    expect(screen.getByRole("link", { name: "Open the Security page →" })).toHaveAttribute("href", "/app/security");
    expect(byName("validity_days").value).toBe("7");
  });
  it("JOBS off draws the form of before: labels, no sentences, no effect line", () => {
    form(vi.fn<Fn>(async () => SAVED), false);
    expect(document.querySelector("[data-simple]")).toBeNull();
    expect(screen.getByLabelText(/^Days a quote is valid$/)).toBeInTheDocument();
    expect(screen.queryByText("What it will do:")).toBeNull();
  });
});

const version = (over: Partial<QuotePolicyVersion> = {}): QuotePolicyVersion => ({
  id: "55555555-5555-4555-8555-555555555556", version_no: 1, effective_from: "2026-10-01", discount_ceiling_bps: 0, shipping_flat_fee_paise: 0, shipping_free_above_paise: null, shipping_tax_bps: 0, validity_days: 7, new_advance_bps: 5000, repeat_advance_bps: 2500, new_net_days: 10, repeat_net_days: 45, gst_rate_bps: 500, gst_effective_from: "2026-10-01", tax_mode: "exclusive", rounding_mode: "half_up", repeat_credit_limit_paise: 250_000, seller_state: "XX", required_inputs: ["delivery_state"], created_at: "2026-10-01T10:00:00.000000+00:00", in_force: true, ...over,
});
describe("Settings > Quotes under JOBS: the version in force", () => {
  it("is three plain sentences and a solid chip; the other numbers are under More choices", () => {
    render(<QuotePolicyView versions={[version()]} today="2026-10-08" form={null} embedded simple />);
    const v = document.querySelector('[data-part="quote-simple-version"]') as HTMLElement;
    expect(within(v).getByText("in force today", { selector: ".jb-chip" })).toHaveAttribute("data-tone", "done");
    expect(v).toHaveTextContent("A quote is valid for 7 days.");
    expect(v).toHaveTextContent("A new customer pays 50% in advance and a repeat customer 25%.");
    expect(v).toHaveTextContent("The rest is due 10 days after the quote for a new customer and 45 days for a repeat customer.");
    const more = v.querySelector('[data-part="more-choices"]') as HTMLElement;
    expect(more).not.toHaveAttribute("open");
    expect(more).toHaveTextContent("Most credit for one repeat customer");
    expect(more).toHaveTextContent("₹2,500");
  });
  it("a version that has not started is a waiting chip, a replaced one an info chip; JOBS off keeps the list of before", () => {
    render(<QuotePolicyView versions={[version({ id: "55555555-5555-4555-8555-555555555557", version_no: 2, effective_from: "2026-11-02", in_force: false }), version()]} today="2026-10-08" form={null} embedded simple />);
    expect(screen.getByText("not started yet", { selector: ".jb-chip" })).toHaveAttribute("data-tone", "wait");
    cleanup();
    render(<QuotePolicyView versions={[version()]} today="2026-10-08" form={null} embedded />);
    expect(document.querySelector('[data-part="quote-simple-version"]')).toBeNull();
    expect(screen.getByText("Days a quote is valid")).toBeInTheDocument();
  });
});

describe("Settings > Quotes under JOBS: the section", () => {
  it("opens the sentence form with the JOBS words, and the old form with JOBS off", async () => {
    fetchVersions.mockResolvedValue([version()]);
    process.env.JOBS = "mock";
    render(await QuotePolicySection({ accessToken: "tok", tenantId: T, role: "owner", secondFactorMissing: false, lang: "en", saved: false }));
    fireEvent.click(screen.getByRole("button", { name: "Publish a new version" }));
    expect(formProps.mock.calls[0][0]).toMatchObject({ simple: true });
    expect((formProps.mock.calls[0][0] as { words: Record<string, string> }).words["jobs.set.b.q.valid.line"]).toBe("A quote is valid for {n} days.");
    expect(document.querySelector('[data-part="quote-simple-version"]')).not.toBeNull();
    cleanup();
    formProps.mockClear();
    delete process.env.JOBS;
    render(await QuotePolicySection({ accessToken: "tok", tenantId: T, role: "owner", secondFactorMissing: false, lang: "en", saved: false }));
    fireEvent.click(screen.getByRole("button", { name: "Publish a new version" }));
    expect(formProps.mock.calls[0][0]).toMatchObject({ simple: false });
    expect(document.querySelector('[data-part="quote-simple-version"]')).toBeNull();
  });
  it("a sales person gets the same one sentence as before", async () => {
    process.env.JOBS = "mock";
    render(await QuotePolicySection({ accessToken: "tok", tenantId: T, role: "sales", secondFactorMissing: false, lang: "en", saved: false }));
    expect(screen.getByText("Only an owner or an admin can see and publish the quote policy.")).toBeInTheDocument();
    expect(fetchVersions).not.toHaveBeenCalled();
  });
});
