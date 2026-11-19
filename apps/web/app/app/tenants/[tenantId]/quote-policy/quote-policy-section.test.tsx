import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError } from "@/lib/api/client";
import type { QuotePolicyVersion } from "@/lib/api/quote-policies";
import { redirectMock, redirectTarget } from "@/test/helpers";

const fetchVersions = vi.fn();
const formProps = vi.fn();

vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to) }));
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

const T = "22222222-2222-4222-8222-222222222222";
let role: "owner" | "admin" | "sales" | "viewer" = "owner";
let missing = false; // no authenticator app on this sign-in
const QuotePolicyPage = async (_p?: unknown) => QuotePolicySection({ accessToken: "tok", tenantId: T, role, secondFactorMissing: missing, lang: "en", saved: false });
const props = () => undefined;
const version = (over: Partial<QuotePolicyVersion> = {}): QuotePolicyVersion => ({
  id: "55555555-5555-4555-8555-555555555555",
  version_no: 1,
  effective_from: "2026-10-01",
  discount_ceiling_bps: 0,
  shipping_flat_fee_paise: 0,
  shipping_free_above_paise: null,
  shipping_tax_bps: 0,
  validity_days: 7,
  new_advance_bps: 5000,
  repeat_advance_bps: 2500,
  new_net_days: 10,
  repeat_net_days: 45,
  gst_rate_bps: 500,
  gst_effective_from: "2026-10-01",
  tax_mode: "exclusive",
  rounding_mode: "half_up",
  repeat_credit_limit_paise: 250_000,
  seller_state: "XX",
  required_inputs: ["delivery_state"],
  created_at: "2026-10-01T10:00:00.000000+00:00",
  in_force: true,
  ...over,
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const assertInternalLinks = (c: HTMLElement) => {
  for (const a of Array.from(c.querySelectorAll("a"))) {
    const href = a.getAttribute("href") ?? "";
    expect(href, href).toMatch(/^\/app(\/|$)/);
    expect(href).not.toMatch(/[:\\]|\/\//);
  }
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  role = "owner";
  missing = false;
  fetchVersions.mockResolvedValue([version()]);
});

describe("the quote policy (Settings, Quotes): roles", () => {
  it.each(["owner", "admin"] as const)("a %s sees the versions and the form", async (who) => {
    role = who;
    render(await QuotePolicyPage(props()));
    fireEvent.click(screen.getByRole("button", { name: "Publish a new version" })); // the form opens in place
    expect(screen.getByRole("heading", { level: 2, name: "The quote policy" })).toBeInTheDocument(); // a section of Settings, not a page: no H1 of its own
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.getByText(/Version 1/)).toBeInTheDocument();
    expect(screen.getByText("POLICY-FORM")).toBeInTheDocument();
    expect(fetchVersions).toHaveBeenCalledWith("tok", T);
    expect(screen.queryByText(/Your role/)).toBeNull(); // the frame shows the role now
  });
  it.each(["sales", "viewer"] as const)("a %s gets one plain sentence, no list, no form, and the versions are not even read", async (who) => {
    role = who;
    const { container } = render(await QuotePolicyPage(props()));
    expect(screen.getByText("Only an owner or an admin can see and publish the quote policy.")).toBeInTheDocument();
    expect(screen.queryByText("POLICY-FORM")).toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
    expect(fetchVersions).not.toHaveBeenCalled();
    expect(formProps).not.toHaveBeenCalled();
    expect(container.querySelectorAll("a")).toHaveLength(0); // the way back to the workspace is the frame's now
    assertInternalLinks(container);
  });
});

describe("the quote policy (Settings, Quotes): the form's props", () => {
  it("one new id per render, in canonical form", async () => {
    render(await QuotePolicyPage(props()));
    render(await QuotePolicyPage(props()));
    for (const button of screen.getAllByRole("button", { name: "Publish a new version" })) fireEvent.click(button);
    const [a, b] = formProps.mock.calls.map((c) => c[0] as { policyId: string });
    expect(a.policyId).toMatch(UUID);
    expect(b.policyId).toMatch(UUID);
    expect(a.policyId).not.toBe(b.policyId);
  });
  it("the publish form gets the page's words (without them it drew the raw keys, qp.publish_this_version, on staging)", async () => {
    render(await QuotePolicyPage(props()));
    fireEvent.click(screen.getAllByRole("button", { name: "Publish a new version" })[0]);
    const { words } = formProps.mock.calls[0][0] as { words?: Record<string, string> };
    expect(words?.["qp.publish_this_version"]).toBe("Publish this version");
    expect(words?.["qp.days_a_quote_is_valid"]).toBeTruthy();
  });
  it("passes today in India, and a minimum start date of today when no version starts later", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-08T20:00:00.000Z")); // 01:30 on 9 Oct in India
    render(await QuotePolicyPage(props()));
    fireEvent.click(screen.getByRole("button", { name: "Publish a new version" })); // the form opens in place
    const p = formProps.mock.calls[0][0];
    expect([p.today, p.minDate]).toEqual(["2026-10-09", "2026-10-09"]);
  });
  it("the minimum start date is the newest version's date when that is later than today", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-08T10:00:00.000Z"));
    fetchVersions.mockResolvedValue([version({ id: "77777777-7777-4777-8777-777777777777", version_no: 2, effective_from: "2026-11-02", in_force: false }), version()]);
    render(await QuotePolicyPage(props()));
    fireEvent.click(screen.getByRole("button", { name: "Publish a new version" })); // the form opens in place
    expect(formProps.mock.calls[0][0].minDate).toBe("2026-11-02");
  });
  it("an empty list still gets a form, and the page says no policy is in force", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-08T10:00:00.000Z"));
    fetchVersions.mockResolvedValue([]);
    render(await QuotePolicyPage(props()));
    expect(screen.getByRole("note")).toHaveTextContent("No quote policy is in force.");
    fireEvent.click(screen.getByRole("button", { name: "Publish a new version" })); // the form opens in place
    expect(screen.getByText("POLICY-FORM")).toBeInTheDocument();
    expect(formProps.mock.calls[0][0].minDate).toBe("2026-10-08");
  });
});

describe("the quote policy (Settings, Quotes): the second factor", () => {
  it("without the authenticator (aal1) there is no form, and the page points at the Security page", async () => {
    missing = true;
    const { container } = render(await QuotePolicyPage(props()));
    expect(screen.queryByText("POLICY-FORM")).toBeNull();
    expect(screen.getByText(/needs your two-step code/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the Security page" })).toHaveAttribute("href", "/app/security");
    expect(screen.getByText(/Version 1/)).toBeInTheDocument(); // the list is still shown
    assertInternalLinks(container);
  });
});

describe("the quote policy (Settings, Quotes): failures", () => {
  it("an expired session goes to the sign-in page", async () => {
    fetchVersions.mockRejectedValue(new ApiAuthError("x"));
    expect(await redirectTarget(async () => QuotePolicyPage(props()))).toBe("/login");
  });
  it("a failing list shows the plain 'could not load' sentence, never the API's text", async () => {
    fetchVersions.mockRejectedValue(new Error("CANARY-1a2b"));
    const { container } = render(await QuotePolicyPage(props()));
    expect(container.textContent).toContain("Could not load this from the API");
    expect(container.textContent).not.toContain("CANARY");
    expect(screen.queryByText("POLICY-FORM")).toBeNull();
  });
});

describe("the quote policy (Settings, Quotes): links", () => {
  it("every link on the page is an internal path", async () => {
    const { container } = render(await QuotePolicyPage(props()));
    assertInternalLinks(container);
    expect(screen.queryByRole("link", { name: /← Acme/ })).toBeNull();
  });
  it("shows no e-mail, phone number or address anywhere", async () => {
    const { container } = render(await QuotePolicyPage(props()));
    expect(container.textContent).not.toMatch(/@|\+\d{2}|\d{10}/);
  });
});

