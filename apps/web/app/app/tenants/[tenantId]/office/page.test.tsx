import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { notFoundMock, redirectMock } from "@/test/helpers";
import { agentsStatus } from "@/test/screens/today-fixtures";

const requireUser = vi.fn();
const fetchTenant = vi.fn();
const getAgentsStatus = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to), notFound: () => notFoundMock() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => fetchTenant(...a) }));
vi.mock("@/lib/api/today", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/today")>()), getAgentsStatus: (...a: unknown[]) => getAgentsStatus(...a) }));

import OfficePage from "./page";

const TENANT = "22222222-2222-2222-2222-222222222222";
const props = (query: Record<string, string> = {}) => ({ params: Promise.resolve({ tenantId: TENANT }), searchParams: Promise.resolve(query) }) as unknown as Parameters<typeof OfficePage>[0];

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "user-1", email: "e@example.test", accessToken: "tok" });
  fetchTenant.mockResolvedValue({ id: TENANT, name: "Acme Silks", slug: "acme", role: "viewer" });
  getAgentsStatus.mockResolvedValue(agentsStatus());
});

describe("the Office", () => {
  it("lists all seven helpers from the API for any member; the two that are not built say so", async () => {
    render(await OfficePage(props()));
    expect(getAgentsStatus).toHaveBeenCalledWith("tok", TENANT);
    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(items).toHaveLength(7);
    expect(items[0]).toHaveTextContent("Main agentNot available yet");
    expect(items[1]).toHaveTextContent("Lead FinderNot available yet");
    expect(items[3]).toHaveTextContent("Requirement AnalystWorking");
    expect(items[4]).toHaveTextContent("Quote WriterIdlePrepares a quote from the prices you set. A person approves it.Prepared quote 3");
  });
  it("?agent= chooses a helper, and an unknown word chooses none", async () => {
    render(await OfficePage(props({ agent: "quote_writer" })));
    expect(screen.getByRole("heading", { level: 2, name: "Quote Writer" })).toBeInTheDocument();
    document.body.innerHTML = "";
    render(await OfficePage(props({ agent: "<script>" })));
    expect(screen.getByText("Choose a teammate to read their latest events.")).toBeInTheDocument();
  });
  it("says 'Not available yet' and names no helper when the status cannot be read", async () => {
    getAgentsStatus.mockRejectedValue(new ApiRequestError(503, "api_unreachable", "x"));
    render(await OfficePage(props()));
    expect(screen.getAllByText("Not available yet")).toHaveLength(1);
    expect(screen.queryByRole("list")).toBeNull();
  });
  it("sends a rejected session to sign in and a missing workspace to not-found", async () => {
    getAgentsStatus.mockRejectedValue(new ApiAuthError("rejected"));
    await expect(OfficePage(props())).rejects.toThrow(/login/);
    fetchTenant.mockRejectedValue(new ApiRequestError(404, "not_found", "x"));
    await expect(OfficePage(props())).rejects.toThrow();
  });
});
