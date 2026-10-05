import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { isNotFound, notFoundMock, redirectMock, redirectTarget } from "@/test/helpers";

const requireUser = vi.fn();
const fetchTenant = vi.fn();
const fetchAgentClaims = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (to: string) => redirectMock(to),
  notFound: () => notFoundMock(),
}));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  fetchTenant: (...a: unknown[]) => fetchTenant(...a),
}));
vi.mock("@/lib/api/agents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/agents")>()),
  fetchAgentClaims: (...a: unknown[]) => fetchAgentClaims(...a),
}));
vi.mock("../suggestion-actions", () => ({
  reviewClaimAction: vi.fn(async () => undefined),
  reviewQueueClaimAction: vi.fn(async () => undefined),
}));

import SuggestionsPage from "./page";

const TENANT = "22222222-2222-2222-2222-222222222222";
const props = (tenantId = TENANT) => ({ params: Promise.resolve({ tenantId }) }) as unknown as Parameters<typeof SuggestionsPage>[0];
const tenant = (role: string) => ({ id: TENANT, name: "Acme", slug: "acme", role });
const claim = {
  id: "44444444-4444-4444-4444-444444444444", company_id: "33333333-3333-3333-3333-333333333333", lead_id: null,
  predicate: "buyer_type", value: "wholesaler", confidence: "unverified", claim_confidence: "unverified", created_via: "agent",
  agent_run_id: "r", created_by: "u", created_at: "2026-10-04T12:00:00+00:00", review_state: "unreviewed", review_confidence: null,
  reviewed_by: null, reviewed_at: null, counts_toward_score: true, company_name: "Saree House",
  evidence: [{ kind: "web_page", stance: "supports", provider: "agent.research", host: "saree-house.test", path: "/", quote: "We sell silk sarees." }],
};

describe("/app/tenants/[tenantId]/suggestions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("crypto", { randomUUID: () => "66666666-6666-4666-8666-666666666666" });
    requireUser.mockResolvedValue({ id: "u", email: "e", accessToken: "tok" });
    fetchTenant.mockResolvedValue(tenant("owner"));
    fetchAgentClaims.mockResolvedValue([claim]);
  });

  it("authenticates FIRST", async () => {
    requireUser.mockImplementation(() => redirectMock("/login"));
    expect(await redirectTarget(() => SuggestionsPage(props()))).toBe("/login");
    expect(fetchTenant).not.toHaveBeenCalled();
    expect(fetchAgentClaims).not.toHaveBeenCalled();
  });

  it("a malformed tenant id is a 404 and asks the API nothing", async () => {
    expect(await isNotFound(() => SuggestionsPage(props("not-a-uuid")))).toBe(true);
    expect(fetchTenant).not.toHaveBeenCalled();
  });

  it("an owner sees the suggestion, its quote, and the controls; the page says what was and was not checked", async () => {
    render(await SuggestionsPage(props()));
    expect(screen.getByRole("heading", { name: "Review suggestions" })).toBeInTheDocument();
    expect(screen.getByText("We sell silk sarees.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument();
    expect(screen.getAllByText(/checked by the agent runtime, not by the database/i).length).toBeGreaterThan(0);
    expect(fetchAgentClaims).toHaveBeenCalledWith("tok", TENANT, "all", 100);
  });

  it("a sales user or a viewer sees the suggestions and no controls", async () => {
    for (const role of ["sales", "viewer"]) {
      fetchTenant.mockResolvedValue(tenant(role));
      const { unmount } = render(await SuggestionsPage(props()));
      expect(screen.getByText("We sell silk sarees.")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
      expect(screen.getByText(/Only an owner or admin can accept or reject/)).toBeInTheDocument();
      unmount();
    }
  });

  it("gives every claim its own pair of review ids", async () => {
    let i = 0;
    vi.stubGlobal("crypto", { randomUUID: () => `66666666-6666-4666-8666-${String(++i).padStart(12, "0")}` });
    render(await SuggestionsPage(props()));
    const found = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="review_id"]')).map((e) => e.value);
    expect(found).toHaveLength(2);
    expect(new Set(found).size).toBe(2);
  });

  it("shows a message, never placeholder data, when the API fails; sends an expired session to login; 404s an unknown workspace", async () => {
    fetchAgentClaims.mockRejectedValue(new ApiRequestError(500, "http_error", "x"));
    render(await SuggestionsPage(props()));
    expect(screen.getByRole("alert")).toHaveTextContent(/Could not load the suggestions/);
    fetchAgentClaims.mockRejectedValue(new ApiAuthError("expired"));
    expect(await redirectTarget(() => SuggestionsPage(props()))).toBe("/login");
    fetchTenant.mockRejectedValue(new ApiRequestError(404, "not_found", "x"));
    expect(await isNotFound(() => SuggestionsPage(props()))).toBe(true);
  });
});
