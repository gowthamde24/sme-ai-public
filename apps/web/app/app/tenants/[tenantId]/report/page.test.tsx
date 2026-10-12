import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { notFoundMock, redirectMock } from "@/test/helpers";

const requireUser = vi.fn();
const fetchTenant = vi.fn();
const readReport = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to), notFound: () => notFoundMock(), useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/i18n/get-lang", () => ({ getLang: async () => "en" }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => fetchTenant(...a) }));
vi.mock("./report-data", () => ({ readReport: (...a: unknown[]) => readReport(...a) }));

import ReportPage from "./page";

const TENANT = "22222222-2222-2222-2222-222222222222";
const props = (tenantId = TENANT) => ({ params: Promise.resolve({ tenantId }) }) as unknown as Parameters<typeof ReportPage>[0];
const NOW = Date.parse("2026-10-14T04:30:00Z");
const data = {
  range: { from: "2026-10-12", to: "2026-10-18", today: "2026-10-14" },
  visits: "error",
  messages: { sent: 1, waiting: 0, blocked: 0 },
  approval: null,
  sarees: { top: [], unmatched: 0, withPhotos: 0, capped: false },
  aiPercent: 10,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  requireUser.mockResolvedValue({ id: "u", email: "e@example.test", accessToken: "tok" });
  fetchTenant.mockResolvedValue({ id: TENANT, name: "Acme", slug: "acme", role: "owner" });
  readReport.mockResolvedValue(data);
});
afterEach(() => vi.useRealTimers());

describe("the This week page", () => {
  it("reads the report with the person's token for the current moment and draws it", async () => {
    render(await ReportPage(props()));
    expect(readReport).toHaveBeenCalledWith("tok", TENANT, NOW);
    expect(screen.getByRole("heading", { level: 1, name: "This week" })).toBeInTheDocument();
  });
  it("an admin may read it", async () => {
    fetchTenant.mockResolvedValue({ id: TENANT, name: "Acme", slug: "acme", role: "admin" });
    render(await ReportPage(props()));
    expect(readReport).toHaveBeenCalled();
  });
  it.each(["sales", "viewer"])("%s is told it is for the owner and admins, and nothing is read", async (role) => {
    fetchTenant.mockResolvedValue({ id: TENANT, name: "Acme", slug: "acme", role });
    render(await ReportPage(props()));
    expect(screen.getByRole("heading", { name: "This page is for the owner and admins" })).toBeInTheDocument();
    expect(readReport).not.toHaveBeenCalled();
  });
  it("sends a rejected session to sign in, from either read", async () => {
    fetchTenant.mockRejectedValueOnce(new ApiAuthError());
    await expect(ReportPage(props())).rejects.toThrow(/login/);
    readReport.mockRejectedValueOnce(new ApiAuthError());
    await expect(ReportPage(props())).rejects.toThrow(/login/);
  });
  it("404 for a workspace that is not theirs or an id that is not an id", async () => {
    fetchTenant.mockRejectedValueOnce(new ApiRequestError(404, "not_found", "x"));
    await expect(ReportPage(props())).rejects.toThrow();
    await expect(ReportPage(props("nope"))).rejects.toThrow();
  });
  it("says the API is down instead of drawing a report", async () => {
    fetchTenant.mockRejectedValueOnce(new Error("down"));
    render(await ReportPage(props()));
    expect(readReport).not.toHaveBeenCalled();
  });
});
