import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { redirectMock, redirectTarget } from "@/test/helpers";

const requireUser = vi.fn();
const fetchMe = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (to: string) => redirectMock(to),
}));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  fetchMe: (token: string) => fetchMe(token),
}));
vi.mock("./actions", () => ({ signOut: vi.fn(), createTenantAction: vi.fn() }));

import AppPage from "./page";

const USER = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "owner@example.test",
  accessToken: "tok",
};
const TENANT = {
  id: "22222222-2222-2222-2222-222222222222",
  name: "Acme Silks",
  slug: "acme-silks",
};

describe("/app page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUser.mockResolvedValue(USER);
  });

  it("renders the real memberships returned by /v1/me, fetched with the user's token", async () => {
    fetchMe.mockResolvedValue({
      user_id: USER.id,
      memberships: [{ role: "owner", tenant: TENANT }],
    });
    render(await AppPage());
    expect(fetchMe).toHaveBeenCalledWith("tok");
    expect(
      screen.getByRole("cell", { name: "Acme Silks" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("cell", { name: "acme-silks" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "owner" })).toBeInTheDocument();
    expect(screen.getByText(/owner@example.test/)).toBeInTheDocument();
  });

  it("explains an empty state instead of inventing data", async () => {
    fetchMe.mockResolvedValue({ user_id: USER.id, memberships: [] });
    render(await AppPage());
    expect(
      screen.getByText(/do not belong to a workspace yet/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows an error, not fake data, when the API is down", async () => {
    fetchMe.mockRejectedValue(
      new ApiRequestError(503, "api_unreachable", "down"),
    );
    render(await AppPage());
    expect(screen.getByRole("alert")).toHaveTextContent(/could not load/i);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("sends the user back to /login when the API rejects the session", async () => {
    fetchMe.mockRejectedValue(new ApiAuthError("expired"));
    expect(await redirectTarget(() => AppPage())).toBe("/login");
  });

  it("refuses to render when the API and Supabase Auth disagree about who this is", async () => {
    fetchMe.mockResolvedValue({
      user_id: "99999999-9999-9999-9999-999999999999",
      memberships: [],
    });
    expect(await redirectTarget(() => AppPage())).toBe("/login");
  });

  it("an unauthenticated visitor never reaches the API call", async () => {
    requireUser.mockImplementation(() => redirectMock("/login"));
    expect(await redirectTarget(() => AppPage())).toBe("/login");
    expect(fetchMe).not.toHaveBeenCalled();
  });
});
