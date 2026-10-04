import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "@/lib/api/client";
import {
  isNotFound,
  notFoundMock,
  redirectMock,
  redirectTarget,
} from "@/test/helpers";

const requireUser = vi.fn();
const fetchTenant = vi.fn();
const fetchErasureRequests = vi.fn();
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
vi.mock("@/lib/api/erasure", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/erasure")>()),
  fetchErasureRequests: (...a: unknown[]) => fetchErasureRequests(...a),
}));
vi.mock("@/lib/api/crm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/crm")>()),
  fetchPage: (...a: unknown[]) => fetchPage(...a),
}));
vi.mock("./actions", () => ({
  requestErasureAction: vi.fn(async () => undefined),
  previewErasureAction: vi.fn(async () => undefined),
  executeErasureAction: vi.fn(async () => undefined),
  cancelErasureAction: vi.fn(async () => undefined),
}));

import PrivacyPage from "./page";

const TENANT = "22222222-2222-2222-2222-222222222222";
const REQ = "44444444-4444-4444-4444-444444444444";
const ME = "55555555-5555-4555-8555-555555555555";
const FORM_ID = "66666666-6666-4666-8666-666666666666";
const CONTACT = "33333333-3333-3333-3333-333333333333";

const props = (tenantId = TENANT) =>
  ({ params: Promise.resolve({ tenantId }) }) as unknown as Parameters<
    typeof PrivacyPage
  >[0];
const tenant = (role: string) => ({
  id: TENANT,
  name: "Acme",
  slug: "acme",
  role,
});
const result = {
  request_id: REQ,
  scope: "contact",
  status: "executed",
  dry_run: false,
  counts: { "contacts.email": 1 },
  review: [{ table: "evidence", column: "snippet", id: CONTACT }],
  review_truncated: false,
  exports_logged: 1,
  note: "Names are matched only when a whole field equals the name.",
  replayed: false,
};
const request = (over: Record<string, unknown> = {}) => ({
  id: REQ,
  scope: "contact",
  subject_id: CONTACT,
  status: "pending",
  requested_by: ME,
  created_at: "2026-10-05T12:00:00+00:00",
  execute_after: "2026-10-05T12:00:00+00:00",
  executed_by: null,
  executed_at: null,
  cancelled_by: null,
  cancelled_at: null,
  result: null,
  ...over,
});

describe("/app/tenants/[tenantId]/privacy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("crypto", { randomUUID: () => FORM_ID });
    requireUser.mockResolvedValue({ id: ME, email: "e", accessToken: "tok" });
    fetchTenant.mockResolvedValue(tenant("owner"));
    fetchErasureRequests.mockResolvedValue({
      items: [request()],
      next_cursor: null,
    });
    fetchPage.mockImplementation(
      async (_t: string, _id: string, entity: string) =>
        entity === "contacts"
          ? {
              entity,
              items: [{ id: CONTACT, full_name: "Asha Rao" }],
              nextCursor: null,
            }
          : {
              entity,
              items: [
                {
                  id: "77777777-7777-4777-8777-777777777777",
                  name: "DEMO Silks",
                },
              ],
              nextCursor: null,
            },
    );
  });

  it("authenticates FIRST", async () => {
    requireUser.mockImplementation(() => redirectMock("/login"));
    expect(await redirectTarget(() => PrivacyPage(props()))).toBe("/login");
    expect(fetchTenant).not.toHaveBeenCalled();
  });

  it("an unknown or foreign workspace is the not-found page; a malformed id never reaches the API", async () => {
    fetchTenant.mockRejectedValue(new ApiRequestError(404, "not_found", "x"));
    expect(await isNotFound(() => PrivacyPage(props()))).toBe(true);
    expect(await isNotFound(() => PrivacyPage(props("nope")))).toBe(true);
  });

  it("Sales and Viewers see a refusal and nothing is fetched for them", async () => {
    for (const role of ["sales", "viewer"]) {
      fetchTenant.mockResolvedValue(tenant(role));
      const { unmount } = render(await PrivacyPage(props()));
      expect(
        screen.getByText(/Only an owner or admin can ask/),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Request erasure" }),
      ).toBeNull();
      unmount();
    }
    expect(fetchErasureRequests).not.toHaveBeenCalled();
  });

  it("the owner can ask, preview, erase (with a confirmation box) and cancel; the id comes from the page", async () => {
    render(await PrivacyPage(props()));
    expect(
      screen.getByRole("button", { name: "Request erasure" }),
    ).toBeInTheDocument();
    expect(
      (document.querySelector('input[name="request_id"]') as HTMLInputElement)
        .value,
    ).toBe(FORM_ID);
    expect(screen.getByText("Waiting for the owner")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Erase now" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /cannot be undone/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Cancel request" }),
    ).toBeInTheDocument();
    expect(screen.getByText("you")).toBeInTheDocument();
  });

  it("an admin can ask and cancel but cannot run", async () => {
    fetchTenant.mockResolvedValue(tenant("admin"));
    render(await PrivacyPage(props()));
    expect(
      screen.getByRole("button", { name: "Request erasure" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Cancel request" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Erase now" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Preview" })).toBeNull();
    expect(screen.getByText(/Only the owner can run this/)).toBeInTheDocument();
  });

  it("a completed request shows counts, the review list (ids only), the exports warning and the limit of names", async () => {
    fetchErasureRequests.mockResolvedValue({
      items: [request({ status: "executed", result })],
      next_cursor: null,
    });
    render(await PrivacyPage(props()));
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText(/contacts.email \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/1 row needs a manual review/)).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(`evidence.snippet, row ${CONTACT}`)),
    ).toBeInTheDocument();
    expect(screen.getByText(/1 export was made/)).toBeInTheDocument();
    expect(
      screen.getByText(
        /Names are matched only when a whole field equals the name/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Erase now" })).toBeNull();
  });

  it("states what the procedure cannot do", async () => {
    render(await PrivacyPage(props()));
    expect(
      screen.getByText(/cannot be undone/, { selector: "p" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/files you already exported or downloaded, or backups/),
    ).toBeInTheDocument();
    expect(screen.getByText(/keeps company names and places/)).toBeInTheDocument();
  });

  it("an API failure is an error, never placeholder data", async () => {
    fetchErasureRequests.mockRejectedValue(new Error("down"));
    render(await PrivacyPage(props()));
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
    expect(
      screen.queryByRole("button", { name: "Request erasure" }),
    ).toBeNull();
  });
});
