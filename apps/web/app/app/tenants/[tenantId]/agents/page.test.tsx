import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "@/lib/api/client";
import { isNotFound, notFoundMock, redirectMock, redirectTarget } from "@/test/helpers";

const requireUser = vi.fn();
const fetchTenant = vi.fn();
const fetchAgentSettings = vi.fn();
const fetchRuns = vi.fn();
const fetchPage = vi.fn();

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
  fetchAgentSettings: (...a: unknown[]) => fetchAgentSettings(...a),
  fetchRuns: (...a: unknown[]) => fetchRuns(...a),
}));
vi.mock("@/lib/api/crm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/crm")>()),
  fetchPage: (...a: unknown[]) => fetchPage(...a),
}));
vi.mock("./actions", () => ({
  toggleAgentsAction: vi.fn(async () => undefined),
  startRunAction: vi.fn(async () => undefined),
  cancelRunAction: vi.fn(async () => undefined),
}));

import AgentsPage from "./page";

const TENANT = "22222222-2222-2222-2222-222222222222";
const COMPANY = "33333333-3333-3333-3333-333333333333";
const RUN_ID = "44444444-4444-4444-4444-444444444444";
const ME = "55555555-5555-4555-8555-555555555555";
const FORM_ID = "66666666-6666-4666-8666-666666666666";

const props = (tenantId = TENANT) =>
  ({ params: Promise.resolve({ tenantId }) }) as unknown as Parameters<typeof AgentsPage>[0];
const tenant = (role: string) => ({ id: TENANT, name: "Acme", slug: "acme", role });
const run = (over: Record<string, unknown> = {}) => ({
  id: RUN_ID,
  agent_name: "selftest",
  agent_version: "selftest-1",
  status: "running",
  started_by: ME,
  company_id: COMPANY,
  lead_id: null,
  created_at: "2026-10-04T12:00:00+00:00",
  expires_at: "2026-10-04T12:15:00+00:00",
  finished_at: null,
  error_code: null,
  cancel_requested: false,
  max_writes: 6,
  writes_used: 3,
  ...over,
});

describe("/app/tenants/[tenantId]/agents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("crypto", { randomUUID: () => FORM_ID });
    requireUser.mockResolvedValue({ id: ME, email: "e", accessToken: "tok" });
    fetchTenant.mockResolvedValue(tenant("owner"));
    fetchAgentSettings.mockResolvedValue({ enabled: true });
    fetchRuns.mockResolvedValue({ items: [run()], next_cursor: null });
    fetchPage.mockResolvedValue({ entity: "companies", items: [{ id: COMPANY, name: "DEMO Silks" }], nextCursor: null });
  });

  it("authenticates FIRST", async () => {
    requireUser.mockImplementation(() => redirectMock("/login"));
    expect(await redirectTarget(() => AgentsPage(props()))).toBe("/login");
    expect(fetchTenant).not.toHaveBeenCalled();
  });

  it("an unknown or foreign workspace is the not-found page; a malformed id never reaches the API", async () => {
    fetchTenant.mockRejectedValue(new ApiRequestError(404, "not_found", "x"));
    expect(await isNotFound(() => AgentsPage(props()))).toBe(true);
    expect(await isNotFound(() => AgentsPage(props("nope")))).toBe(true);
  });

  it("shows real state: the switch, and the runs the API returned", async () => {
    render(await AgentsPage(props()));
    expect(screen.getByText("on")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("3/6")).toBeInTheDocument();
    expect(screen.getByText("you")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Company" })).toHaveAttribute(
      "href",
      `/app/tenants/${TENANT}/companies/${COMPANY}`,
    );
  });

  it("an owner or admin gets the switch; Sales and Viewers do not", async () => {
    for (const role of ["owner", "admin"]) {
      fetchTenant.mockResolvedValue(tenant(role));
      const { unmount } = render(await AgentsPage(props()));
      expect(screen.getByRole("button", { name: "Turn agents off" })).toBeInTheDocument();
      unmount();
    }
    for (const role of ["sales", "viewer"]) {
      fetchTenant.mockResolvedValue(tenant(role));
      const { unmount } = render(await AgentsPage(props()));
      expect(screen.queryByRole("button", { name: /Turn agents/ })).toBeNull();
      expect(screen.getByText(/Only an owner or admin can change this/)).toBeInTheDocument();
      unmount();
    }
  });

  it("the start form is for owner, admin and Sales, and only while agents are on", async () => {
    for (const role of ["owner", "admin", "sales"]) {
      fetchTenant.mockResolvedValue(tenant(role));
      const { unmount } = render(await AgentsPage(props()));
      expect(screen.getByRole("button", { name: "Start selftest run" })).toBeInTheDocument();
      expect((document.querySelector('input[name="run_id"]') as HTMLInputElement).value).toBe(FORM_ID);
      unmount();
    }
    fetchTenant.mockResolvedValue(tenant("viewer"));
    let view = render(await AgentsPage(props()));
    expect(screen.queryByRole("button", { name: "Start selftest run" })).toBeNull();
    view.unmount();
    fetchTenant.mockResolvedValue(tenant("owner"));
    fetchAgentSettings.mockResolvedValue({ enabled: false });
    view = render(await AgentsPage(props()));
    expect(screen.queryByRole("button", { name: "Start selftest run" })).toBeNull();
    expect(screen.getByRole("button", { name: "Turn agents on" })).toBeInTheDocument();
  });

  it("Cancel appears only for a running run the user started, or for an owner or admin", async () => {
    fetchTenant.mockResolvedValue(tenant("sales"));
    fetchRuns.mockResolvedValue({
      items: [run({ id: "a".repeat(8) + "-0000-4000-8000-000000000001" }), run({ started_by: "someone-else" })],
      next_cursor: null,
    });
    let view = render(await AgentsPage(props()));
    expect(screen.getAllByRole("button", { name: "Cancel" })).toHaveLength(1);
    view.unmount();
    fetchTenant.mockResolvedValue(tenant("admin"));
    view = render(await AgentsPage(props()));
    expect(screen.getAllByRole("button", { name: "Cancel" })).toHaveLength(2);
    view.unmount();
    fetchRuns.mockResolvedValue({ items: [run({ status: "succeeded" })], next_cursor: null });
    view = render(await AgentsPage(props()));
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(screen.getByText("Completed")).toBeInTheDocument();
  });

  it("run states use the product's words: nothing is 'Approved' or 'Sent' by an agent", async () => {
    fetchRuns.mockResolvedValue({
      items: ["failed", "cancelled", "expired", "killed"].map((status) => run({ status })),
      next_cursor: null,
    });
    const { container } = render(await AgentsPage(props()));
    const table = within(container.querySelector("table") as HTMLElement);
    for (const word of ["Failed", "Cancelled", "Failed (expired)", "Failed (switched off)"])
      expect(table.getByText(word)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/Approved|Sent/);
  });

  it("says so when the API cannot be reached; never placeholder data", async () => {
    fetchAgentSettings.mockRejectedValue(new ApiRequestError(503, "api_unreachable", "x"));
    render(await AgentsPage(props()));
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
    expect(screen.queryByText("Running")).toBeNull();
  });
});
