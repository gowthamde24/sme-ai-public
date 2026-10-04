import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import type {
  IcpConfigOut,
  PageReviewQueueLeadOut,
  ReviewQueueLeadOut,
} from "@/lib/api/leads";
import {
  isNotFound,
  notFoundMock,
  redirectMock,
  redirectTarget,
} from "@/test/helpers";

const requireUser = vi.fn();
const fetchTenant = vi.fn();
const fetchReviewQueue = vi.fn();
const fetchActiveIcpConfig = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (to: string) => redirectMock(to),
  notFound: () => notFoundMock(),
}));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  fetchTenant: (...a: unknown[]) => fetchTenant(...a),
}));
vi.mock("@/lib/api/leads", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/leads")>()),
  fetchReviewQueue: (...a: unknown[]) => fetchReviewQueue(...a),
  fetchActiveIcpConfig: (...a: unknown[]) => fetchActiveIcpConfig(...a),
}));
vi.mock("./actions", () => ({
  labelLeadAction: vi.fn(async () => ({ ok: true })),
  importLeadsAction: vi.fn(async () => ({ ok: true })),
}));

import ReviewQueuePage from "./page";

const TENANT = "22222222-2222-2222-2222-222222222222";
const LEAD_1 = "33333333-3333-3333-3333-333333333331";
const LEAD_2 = "33333333-3333-3333-3333-333333333332";
const USER = { id: "u", email: "reviewer@example.test", accessToken: "tok" };

function props(
  over: { tenantId?: string; query?: Record<string, string | string[]> } = {},
) {
  return {
    params: Promise.resolve({ tenantId: over.tenantId ?? TENANT }),
    searchParams: Promise.resolve(over.query ?? {}),
  } as unknown as Parameters<typeof ReviewQueuePage>[0];
}

const tenant = (role: string) => ({
  id: TENANT,
  name: "Acme Silks",
  slug: "acme-silks",
  role,
});

const sampleIcp: IcpConfigOut = {
  id: "44444444-4444-4444-4444-444444444444",
  tenant_id: TENANT,
  version_no: 1,
  engine: "icp-rules",
  schema_version: 1,
  config: {},
  config_sha256: "0123456789abcdef0123456789abcdef",
  created_by: null,
  created_via: "manual",
  created_at: "2026-10-04T00:00:00Z",
};

const sampleLead1: ReviewQueueLeadOut = {
  lead_id: LEAD_1,
  status: "new",
  source: "directory",
  created_at: "2026-10-04T01:00:00Z",
  company: {
    name: "Kanchipuram Silks Emporium",
    city: "Bengaluru",
    country: "IN",
    industry: "Silk Wholesale",
  },
  contact: {
    full_name: "Gowtham",
    email: "gowtham@example.test",
    phone: "+919876543210",
    job_title: "Proprietor",
  },
  latest_label: null,
  score: null,
  score_max_reachable: null,
  score_band: null,
  snapshot: null,
};

const sampleLead2: ReviewQueueLeadOut = {
  lead_id: LEAD_2,
  status: "new",
  source: "referral",
  created_at: "2026-10-04T02:00:00Z",
  company: {
    name: "Dharmavaram Saree Traders",
    city: "Dharmavaram",
    country: "IN",
    industry: "Saree Retailing",
  },
  contact: null,
  latest_label: {
    id: "label-2",
    tenant_id: TENANT,
    lead_id: LEAD_2,
    label: "bad",
    reason_code: "wrong_product",
    icp_version_id: sampleIcp.id,
    score: 35,
    score_max_reachable: 100,
    snapshot: null,
    created_by: "u",
    created_via: "manual",
    created_at: "2026-10-04T02:30:00Z",
  },
  score: 35,
  score_max_reachable: 100,
  score_band: "low_priority",
  snapshot: {
    factors: {
      silk_saree_fit: { points: 0, max_points: 25, unknown: false },
      geography_fit: { points: 12, max_points: 20, unknown: false },
    },
  },
};

const emptyQueue: PageReviewQueueLeadOut = {
  items: [],
  next_cursor: null,
};

const standardQueue: PageReviewQueueLeadOut = {
  items: [sampleLead1, sampleLead2],
  next_cursor: null,
};

describe("ReviewQueuePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUser.mockResolvedValue(USER);
    fetchTenant.mockResolvedValue(tenant("owner"));
    fetchActiveIcpConfig.mockResolvedValue(sampleIcp);
    fetchReviewQueue.mockResolvedValue(standardQueue);
  });

  it("renders page title, caller role, and link back to workspace", async () => {
    render(await ReviewQueuePage(props()));
    expect(
      screen.getByRole("heading", { level: 1, name: "Lead Review Queue" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Role: owner")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Workspace" })).toHaveAttribute(
      "href",
      `/app/tenants/${TENANT}`,
    );
  });

  it("shows active ICP banner with version and sha256 prefix", async () => {
    render(await ReviewQueuePage(props()));
    expect(screen.getByText(/Active ICP Profile:/i)).toBeInTheDocument();
    expect(screen.getByText(/Version 1/i)).toBeInTheDocument();
    expect(screen.getByText(/0123456789ab/i)).toBeInTheDocument();
  });

  it("indicates when no active ICP profile exists", async () => {
    fetchActiveIcpConfig.mockResolvedValue(null);
    render(await ReviewQueuePage(props()));
    expect(
      screen.getByText(/No profile published yet/i),
    ).toBeInTheDocument();
  });

  it("shows export links for Owner and Admin roles, hiding them for Sales and Viewer", async () => {
    render(await ReviewQueuePage(props()));
    expect(screen.getByRole("link", { name: "Export CSV" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Export JSON" })).toBeInTheDocument();

    fetchTenant.mockResolvedValue(tenant("admin"));
    render(await ReviewQueuePage(props()));
    expect(screen.getAllByRole("link", { name: "Export CSV" })).toHaveLength(2);

    fetchTenant.mockResolvedValue(tenant("sales"));
    const { container: salesContainer } = render(await ReviewQueuePage(props()));
    expect(
      within(salesContainer).queryByRole("link", { name: "Export CSV" }),
    ).not.toBeInTheDocument();

    fetchTenant.mockResolvedValue(tenant("viewer"));
    const { container: viewerContainer } = render(await ReviewQueuePage(props()));
    expect(
      within(viewerContainer).queryByRole("link", { name: "Export CSV" }),
    ).not.toBeInTheDocument();
  });

  it("defaults to blind scoring enabled", async () => {
    render(await ReviewQueuePage(props()));
    expect(screen.getByText("Blind Scoring: ON")).toBeInTheDocument();
    expect(fetchReviewQueue).toHaveBeenCalledWith(
      "tok",
      TENANT,
      expect.objectContaining({ blind: true }),
    );
    // Unreviewed lead shows Score Hidden (Blind)
    expect(screen.getByText("Score Hidden (Blind)")).toBeInTheDocument();
  });

  it("toggles blind scoring off when ?blind=false", async () => {
    render(await ReviewQueuePage(props({ query: { blind: "false" } })));
    expect(screen.getByText("Blind Scoring: OFF")).toBeInTheDocument();
    expect(fetchReviewQueue).toHaveBeenCalledWith(
      "tok",
      TENANT,
      expect.objectContaining({ blind: false }),
    );
  });

  it("renders lead cards with company and contact information", async () => {
    render(await ReviewQueuePage(props()));
    expect(
      screen.getByRole("heading", {
        level: 3,
        name: "Kanchipuram Silks Emporium",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Bengaluru, IN/i)).toBeInTheDocument();
    expect(screen.getByText(/Silk Wholesale/i)).toBeInTheDocument();
    expect(screen.getByText(/Gowtham/i)).toBeInTheDocument();
    expect(screen.getByText(/gowtham@example\.test/i)).toBeInTheDocument();

    // Second lead
    expect(
      screen.getByRole("heading", {
        level: 3,
        name: "Dharmavaram Saree Traders",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/BAD \(wrong_product\)/i)).toBeInTheDocument();
  });

  it("shows evidence link pointing to the lead detail page", async () => {
    render(await ReviewQueuePage(props()));
    const evidenceLinks = screen.getAllByRole("link", {
      name: "View Evidence & Details →",
    });
    expect(evidenceLinks[0]).toHaveAttribute(
      "href",
      `/app/tenants/${TENANT}/leads/${LEAD_1}`,
    );
    expect(evidenceLinks[1]).toHaveAttribute(
      "href",
      `/app/tenants/${TENANT}/leads/${LEAD_2}`,
    );
  });

  it("renders lead labeling form for writable roles (owner, admin, sales)", async () => {
    render(await ReviewQueuePage(props()));
    expect(screen.getAllByRole("button", { name: "Good" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Maybe" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Bad..." })).toHaveLength(2);
  });

  it("hides labeling form and import form from viewer role", async () => {
    fetchTenant.mockResolvedValue(tenant("viewer"));
    render(await ReviewQueuePage(props()));
    expect(
      screen.queryByRole("button", { name: "Good" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /import/i }),
    ).not.toBeInTheDocument();
  });

  it("shows empty state when queue is empty", async () => {
    fetchReviewQueue.mockResolvedValue(emptyQueue);
    render(await ReviewQueuePage(props()));
    expect(
      screen.getByText("No leads in the review queue yet."),
    ).toBeInTheDocument();
  });

  it("offers Load more when queue has next_cursor", async () => {
    fetchReviewQueue.mockResolvedValue({
      ...standardQueue,
      next_cursor: "next-page-token",
    });
    render(await ReviewQueuePage(props()));
    const more = screen.getByRole("link", { name: "Load more leads" });
    expect(more).toHaveAttribute(
      "href",
      expect.stringContaining("cursor=next-page-token"),
    );
  });

  it("triggers notFound on invalid tenant UUID", async () => {
    const found = await isNotFound(() =>
      ReviewQueuePage(props({ tenantId: "not-a-uuid" })),
    );
    expect(found).toBe(true);
  });

  it("redirects to /login when session is rejected by API", async () => {
    fetchTenant.mockRejectedValue(new ApiAuthError("expired"));
    const target = await redirectTarget(() => ReviewQueuePage(props()));
    expect(target).toBe("/login");
  });

  it("shows error alert if review queue fails to load", async () => {
    fetchReviewQueue.mockRejectedValue(
      new ApiRequestError(500, "internal_error", "Server Error"),
    );
    render(await ReviewQueuePage(props()));
    expect(
      screen.getByText(/Could not load the review queue from the API/i),
    ).toBeInTheDocument();
  });
});
