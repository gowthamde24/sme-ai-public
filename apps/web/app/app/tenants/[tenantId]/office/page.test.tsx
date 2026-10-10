import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { notFoundMock, redirectMock } from "@/test/helpers";
import { AGENTS_JSON, agentsStatus } from "@/test/screens/today-fixtures";
import { parseAgentsStatus } from "@/lib/api/today";

const requireUser = vi.fn();
const fetchTenant = vi.fn();
const getAgentsStatus = vi.fn();
const fetchQuotes = vi.fn();
const fetchQuote = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to), notFound: () => notFoundMock() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => fetchTenant(...a) }));
vi.mock("@/lib/api/today", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/today")>()), getAgentsStatus: (...a: unknown[]) => getAgentsStatus(...a) }));

vi.mock("@/lib/api/quotes", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/quotes")>()), fetchQuotes: (...a: unknown[]) => fetchQuotes(...a), fetchQuote: (...a: unknown[]) => fetchQuote(...a) }));

// the device: a weak one, so the List is the first view (the 3D view is tested in OfficeRoom.test.tsx)
vi.mock("@/components/v2/app/office/scene/capability", async (orig) => ({
  ...(await orig<typeof import("@/components/v2/app/office/scene/capability")>()),
  readClientEnv: () => ({ defaultView: "list", weak: true, webgl: false, reducedMotion: false, remembered: null, coarse: false, phone: false }),
}));

import OfficePage from "./page";

const TENANT = "22222222-2222-2222-2222-222222222222";
const props = (query: Record<string, string> = {}) => ({ params: Promise.resolve({ tenantId: TENANT }), searchParams: Promise.resolve(query) }) as unknown as Parameters<typeof OfficePage>[0];

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "user-1", email: "e@example.test", accessToken: "tok" });
  fetchTenant.mockResolvedValue({ id: TENANT, name: "Acme Silks", slug: "acme", role: "viewer" });
  getAgentsStatus.mockResolvedValue(agentsStatus());
  fetchQuotes.mockResolvedValue([]);
  fetchQuote.mockRejectedValue(new ApiRequestError(404, "not_found", "x"));
});

describe("the Office", () => {
  it("lists all seven helpers from the API for any member; the two that are not built say so", async () => {
    render(await OfficePage(props()));
    expect(getAgentsStatus).toHaveBeenCalledWith("tok", TENANT);
    const items = within(screen.getByRole("region", { name: "Agent office" })).getAllByRole("listitem");
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
    expect(screen.getByText("Tap a teammate in the room, or choose one in the list, to read their latest events here.")).toBeInTheDocument();
  });
  it("says 'Not available yet' and names no helper when the status cannot be read", async () => {
    getAgentsStatus.mockRejectedValue(new ApiRequestError(503, "api_unreachable", "x"));
    render(await OfficePage(props()));
    expect(screen.getAllByText("Not available yet")).toHaveLength(1);
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByRole("button", { name: "3D view" })).toBeNull();
  });
  it("sends a rejected session to sign in and a missing workspace to not-found", async () => {
    getAgentsStatus.mockRejectedValue(new ApiAuthError("rejected"));
    await expect(OfficePage(props())).rejects.toThrow(/login/);
    fetchTenant.mockRejectedValue(new ApiRequestError(404, "not_found", "x"));
    await expect(OfficePage(props())).rejects.toThrow();
  });
});

describe("the Office: each latest event opens the page it is about", () => {
  const Q = "44444444-4444-4444-8444-444444444444";
  const E = "55555555-5555-4555-8555-555555555555";
  const L = "66666666-6666-4666-8666-666666666666";
  const O = "77777777-7777-4777-8777-777777777777";
  const withTargets = () =>
    parseAgentsStatus(
      AGENTS_JSON.map((a) =>
        a.agent === "quote_writer" ? { ...a, last_event: { ...a.last_event!, target: { type: "quote", id: Q } } }
        : a.agent === "followup_desk" ? { ...a, last_event: { ...a.last_event!, target: { type: "lead", id: L } } }
        : a.agent === "order_desk" ? { ...a, last_event: { ...a.last_event!, target: { type: "order", id: O } } }
        : a.agent === "main" ? { ...a, state: "idle", last_event: { text: "Answered a question", at: "2026-10-06T05:00:00+00:00", target: null } }
        : a,
      ),
    );
  it("the feed links an event by its target (a quote opens its enquiry; an order and a lead open their own pages) and a null target is plain text", async () => {
    getAgentsStatus.mockResolvedValue(withTargets());
    fetchQuotes.mockResolvedValue([{ id: Q, enquiry_id: E }]);
    render(await OfficePage(props()));
    const feed = screen.getByRole("heading", { name: "Event feed" }).closest("section")!;
    expect(within(feed).getByRole("link", { name: "Prepared quote 3" })).toHaveAttribute("href", `/app/tenants/${TENANT}/enquiries/${E}?quote=${Q}`);
    expect(within(feed).getByRole("link", { name: "Drafted follow-up message number 2" })).toHaveAttribute("href", `/app/tenants/${TENANT}/leads/${L}`);
    expect(within(feed).getByRole("link", { name: "Order started" })).toHaveAttribute("href", `/app/tenants/${TENANT}/orders/${O}`);
    expect(within(feed).getByText("Answered a question").closest("a")).toBeNull(); // the Main agent's answers have no screen
  });
  it("the chosen helper's panel links its latest event the same way; a quote that cannot be placed opens the list of quotes", async () => {
    getAgentsStatus.mockResolvedValue(withTargets());
    render(await OfficePage(props({ agent: "quote_writer" })));
    const panel = screen.getByRole("heading", { level: 2, name: "Quote Writer" }).closest("section")!;
    expect(within(panel).getByRole("link", { name: "Prepared quote 3" })).toHaveAttribute("href", `/app/tenants/${TENANT}/quotes`);
  });
  it("an event with no target, or no event, has no link, and no quote is read when there is nothing to open", async () => {
    render(await OfficePage(props()));
    const feed = screen.getByRole("heading", { name: "Event feed" }).closest("section")!;
    expect(within(feed).queryByRole("link")).toBeNull();
    expect(fetchQuotes).not.toHaveBeenCalled();
  });
});
