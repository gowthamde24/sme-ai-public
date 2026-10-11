import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { notFoundMock, redirectMock } from "@/test/helpers";
import { parseOutboxPage } from "@/lib/api/outbox";
import { PRICE_JSON, page } from "@/lib/api/outbox-fixtures";
import { STATUS_JSON } from "@/lib/api/scheduler-fixtures";

const requireUser = vi.fn();
const fetchTenant = vi.fn();
const listOutboxMessages = vi.fn();
const getOutboxSettings = vi.fn();
const getSchedulerStatus = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to), notFound: () => notFoundMock(), useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/i18n/get-lang", () => ({ getLang: async () => "en" }));
vi.mock("@/lib/api/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => fetchTenant(...a) }));
vi.mock("@/lib/api/outbox", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/outbox")>()), listOutboxMessages: (...a: unknown[]) => listOutboxMessages(...a), getOutboxSettings: (...a: unknown[]) => getOutboxSettings(...a) }));
vi.mock("@/lib/api/scheduler", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/scheduler")>()), getSchedulerStatus: (...a: unknown[]) => getSchedulerStatus(...a) }));

import OutboxPage from "./page";

const TENANT = "22222222-2222-2222-2222-222222222222";
const props = (query: Record<string, string> = {}) => ({ params: Promise.resolve({ tenantId: TENANT }), searchParams: Promise.resolve(query) }) as unknown as Parameters<typeof OutboxPage>[0];
const NOW = Date.parse("2026-10-11T05:00:00Z");
const draw = async (query: Record<string, string> = {}) => {
  const ui = await OutboxPage(props(query));
  await act(async () => void render(ui));
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  requireUser.mockResolvedValue({ id: "user-1", email: "e@example.test", accessToken: "tok" });
  fetchTenant.mockResolvedValue({ id: TENANT, name: "Acme", slug: "acme", role: "owner" });
  listOutboxMessages.mockResolvedValue(parseOutboxPage(page([{ ...PRICE_JSON, created_at: "2026-10-11T03:12:00Z" }])));
  getOutboxSettings.mockResolvedValue({ platform_switch_on: true, auto_send_enabled: true, per_customer_daily_limit: 3 });
  getSchedulerStatus.mockResolvedValue({ ...STATUS_JSON, last_run_at: "2026-10-11T04:58:00Z", next_run_at: "2026-10-11T05:01:00Z" });
});
afterEach(() => vi.useRealTimers());

describe("the Outbox page", () => {
  it("opens on 'Waiting for you', the last 7 days, and reads that tab with the person's token", async () => {
    await draw();
    expect(listOutboxMessages).toHaveBeenCalledWith("tok", TENANT, { status: "needs_approval", limit: 100, after: null });
    expect(screen.getByRole("link", { name: /Waiting for you/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Mentions a price")).toBeInTheDocument();
    expect(screen.getByText(/Agent OWL last checked 2 min ago · next check 10:31/)).toBeInTheDocument();
  });
  it("?tab= chooses a tab and an unknown word chooses the first; ?range= and ?q= are checked too", async () => {
    await draw({ tab: "sent", range: "today", q: "Lak" });
    expect(listOutboxMessages.mock.calls.some((c) => c[2].status === "sent")).toBe(true);
    expect(screen.getByLabelText("Customer")).toHaveValue("Lak");
    expect(screen.getByLabelText("Show")).toHaveValue("today");
    document.body.innerHTML = "";
    await draw({ tab: "<script>", range: "forever" });
    expect(screen.getByRole("link", { name: /Waiting for you/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByLabelText("Show")).toHaveValue("7d");
  });
  it("an over-long search or cursor is cut or ignored", async () => {
    await draw({ q: "x".repeat(300), after: "c".repeat(500), tab: "sent" });
    expect((screen.getByLabelText("Customer") as HTMLInputElement).value).toHaveLength(100);
    expect(listOutboxMessages.mock.calls.find((c) => c[2].status === "sent")![2].after).toBeNull();
  });
  it("a Viewer is told it is not for them and nothing is read", async () => {
    fetchTenant.mockResolvedValue({ id: TENANT, name: "Acme", slug: "acme", role: "viewer" });
    await draw();
    expect(screen.getByText("The outbox is for the owner, admins and sales.")).toBeInTheDocument();
    expect(listOutboxMessages).not.toHaveBeenCalled();
  });
  it("Sales read it without the settings and the status", async () => {
    fetchTenant.mockResolvedValue({ id: TENANT, name: "Acme", slug: "acme", role: "sales" });
    await draw();
    expect(getOutboxSettings).not.toHaveBeenCalled();
    expect(getSchedulerStatus).not.toHaveBeenCalled();
    expect(screen.getByText("Mentions a price")).toBeInTheDocument();
  });
  it("the kill switch shows its banner", async () => {
    getOutboxSettings.mockResolvedValue({ platform_switch_on: false, auto_send_enabled: true, per_customer_daily_limit: 3 });
    await draw();
    expect(screen.getByText("Sending is stopped")).toBeInTheDocument();
  });
  it("a list that cannot be read says 'Not available yet'; the rest is drawn", async () => {
    listOutboxMessages.mockRejectedValue(new ApiRequestError(500, "api_error", "x"));
    await draw();
    expect(screen.getByText("Not available yet")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Outbox");
  });
  it("a malformed or foreign workspace is not found; a rejected session signs in; the API being down is its own error", async () => {
    await expect(OutboxPage({ params: Promise.resolve({ tenantId: "nope" }), searchParams: Promise.resolve({}) } as never)).rejects.toThrow("NEXT_NOT_FOUND");
    fetchTenant.mockRejectedValue(new ApiRequestError(404, "not_found", "x"));
    await expect(OutboxPage(props())).rejects.toThrow("NEXT_NOT_FOUND");
    fetchTenant.mockRejectedValue(new ApiAuthError("x"));
    await expect(OutboxPage(props())).rejects.toThrow("NEXT_REDIRECT:/login");
    fetchTenant.mockResolvedValue({ id: TENANT, name: "Acme", slug: "acme", role: "owner" });
    getSchedulerStatus.mockRejectedValue(new ApiAuthError("x"));
    await expect(OutboxPage(props())).rejects.toThrow("NEXT_REDIRECT:/login");
    fetchTenant.mockRejectedValue(new ApiRequestError(503, "api_unreachable", "x"));
    await draw();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
