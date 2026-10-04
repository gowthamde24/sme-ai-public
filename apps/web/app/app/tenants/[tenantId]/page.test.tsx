import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import type { CrmPage } from "@/lib/api/crm";
import {
  isNotFound,
  notFoundMock,
  redirectMock,
  redirectTarget,
} from "@/test/helpers";

const requireUser = vi.fn();
const fetchTenant = vi.fn();
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
vi.mock("@/lib/api/crm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/crm")>()),
  fetchPage: (...a: unknown[]) => fetchPage(...a),
}));
vi.mock("./actions", () => ({
  createCompanyAction: vi.fn(async () => undefined),
}));

import TenantPage from "./page";

const TENANT = "22222222-2222-2222-2222-222222222222";
const FORM_ID = "33333333-3333-3333-3333-333333333333";
const USER = { id: "u", email: "e@example.test", accessToken: "tok" };

function props(
  over: { tenantId?: string; query?: Record<string, string | string[]> } = {},
) {
  return {
    params: Promise.resolve({ tenantId: over.tenantId ?? TENANT }),
    searchParams: Promise.resolve(over.query ?? {}),
  } as unknown as Parameters<typeof TenantPage>[0];
}
const tenant = (role: string) => ({
  id: TENANT,
  name: "Acme Workspace",
  slug: "acme",
  role,
});

const company = {
  id: "c1",
  name: "Acme Silks",
  type: "customer",
  website: "https://acme.example",
  country: "IN",
  city: "Chennai",
  industry: "Silk",
  created_via: "manual",
  created_at: "2026-02-03T04:05:06+00:00",
} as const;
const PAGES: Record<string, CrmPage> = {
  companies: { entity: "companies", items: [company], nextCursor: null },
  contacts: {
    entity: "contacts",
    items: [
      {
        id: "k1",
        full_name: "Pat Example",
        email: "pat@example.test",
        phone: null,
        job_title: "Buyer",
        email_consent: "granted",
        whatsapp_consent: "unknown",
        phone_consent: "withdrawn",
        suppression_reason: "opted_out",
        created_via: "manual",
      },
    ],
    nextCursor: null,
  },
  products: {
    entity: "products",
    items: [
      {
        id: "p1",
        sku: "S-1",
        name: "Kanjivaram",
        unit: "pc",
        category: null,
        active: true,
        created_via: "import",
      },
    ],
    nextCursor: null,
  },
  leads: {
    entity: "leads",
    items: [
      {
        id: "l1",
        status: "qualified",
        source: "trade fair",
        created_via: "manual",
        created_at: "2026-02-03T00:00:00+00:00",
      },
    ],
    nextCursor: null,
  },
  opportunities: {
    entity: "opportunities",
    items: [
      {
        id: "o1",
        title: "Wedding order",
        status: "lost",
        closed_at: "2026-03-04T00:00:00+00:00",
        created_via: "agent",
        created_at: "2026-02-03T00:00:00+00:00",
      },
    ],
    nextCursor: null,
  },
};

describe("/app/tenants/[tenantId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("crypto", { randomUUID: () => FORM_ID });
    requireUser.mockResolvedValue(USER);
    fetchTenant.mockResolvedValue(tenant("owner"));
    fetchPage.mockImplementation(
      async (_t: string, _id: string, entity: string) => PAGES[entity],
    );
  });

  // ------------------------------------------------------------------ order and authentication
  it("authenticates FIRST: with no session nothing else is called", async () => {
    requireUser.mockImplementation(() => redirectMock("/login"));
    expect(await redirectTarget(() => TenantPage(props()))).toBe("/login");
    expect(fetchTenant).not.toHaveBeenCalled();
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("calls our API with the user's token for the tenant and the tab", async () => {
    render(await TenantPage(props({ query: { tab: "contacts" } })));
    expect(fetchTenant).toHaveBeenCalledWith("tok", TENANT);
    expect(fetchPage).toHaveBeenCalledWith("tok", TENANT, "contacts", null);
  });

  // ------------------------------------------------------------------------- not found, always the same
  it("a tenant the API says 404 for (unknown OR not a member) is the not-found page", async () => {
    fetchTenant.mockRejectedValue(
      new ApiRequestError(404, "not_found", "Not found."),
    );
    expect(await isNotFound(() => TenantPage(props()))).toBe(true);
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("a malformed tenant id is the same not-found page and never reaches the API", async () => {
    for (const bad of [
      "not-a-uuid",
      "../me",
      TENANT.replaceAll("-", ""),
      "x".repeat(200),
    ]) {
      expect(await isNotFound(() => TenantPage(props({ tenantId: bad })))).toBe(
        true,
      );
    }
    expect(fetchTenant).not.toHaveBeenCalled();
  });

  it("the table request also turning 404 (membership removed mid-visit) is not-found, not data", async () => {
    fetchPage.mockRejectedValue(
      new ApiRequestError(404, "not_found", "Not found."),
    );
    expect(await isNotFound(() => TenantPage(props()))).toBe(true);
  });

  it("a rejected session goes to /login", async () => {
    fetchTenant.mockRejectedValue(new ApiAuthError("expired"));
    expect(await redirectTarget(() => TenantPage(props()))).toBe("/login");
  });

  // ------------------------------------------------------------------------------- the five tables
  it.each([
    ["companies", ["Acme Silks", "customer", "Chennai", "manual"]],
    [
      "contacts",
      [
        "Pat Example",
        "pat@example.test",
        "Buyer",
        "granted",
        "withdrawn",
        "opted_out",
      ],
    ],
    ["products", ["S-1", "Kanjivaram", "pc", "yes", "import"]],
    ["leads", ["qualified", "trade fair", "2026-02-03"]],
    ["opportunities", ["Wedding order", "lost", "2026-03-04", "agent"]],
  ])("shows the %s table with real rows", async (tab, expected) => {
    render(await TenantPage(props({ query: { tab } })));
    const table = screen.getByRole("table");
    for (const text of expected)
      expect(within(table).getByText(text)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: new RegExp(tab, "i") }),
    ).toBeInTheDocument();
  });

  it("defaults to companies and ignores an unknown tab", async () => {
    render(await TenantPage(props({ query: { tab: "../../etc" } })));
    expect(fetchPage).toHaveBeenCalledWith("tok", TENANT, "companies", null);
    render(await TenantPage(props()));
    expect(fetchPage).toHaveBeenLastCalledWith(
      "tok",
      TENANT,
      "companies",
      null,
    );
  });

  it("has a tab link for every table and marks the active one", async () => {
    render(await TenantPage(props({ query: { tab: "leads" } })));
    const nav = screen.getByRole("navigation", { name: "Records" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual([
      "Companies",
      "Contacts",
      "Products",
      "Leads",
      "Opportunities",
    ]);
    expect(links.map((l) => l.getAttribute("href"))).toEqual(
      ["companies", "contacts", "products", "leads", "opportunities"].map(
        (t) => `/app/tenants/${TENANT}?tab=${t}`,
      ),
    );
    expect(within(nav).getByRole("link", { name: "Leads" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("shows the workspace name, the caller's role, and a way back", async () => {
    fetchTenant.mockResolvedValue(tenant("sales"));
    render(await TenantPage(props()));
    expect(
      screen.getByRole("heading", { level: 1, name: "Acme Workspace" }),
    ).toBeInTheDocument();
    expect(screen.getByText("sales")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /workspaces/i })).toHaveAttribute(
      "href",
      "/app",
    );
  });

  // ------------------------------------------------------------------------------------ pagination
  it("offers Load more with the opaque cursor in the URL, only when the API has more", async () => {
    fetchPage.mockResolvedValue({
      ...PAGES.companies,
      nextCursor: "eyJjIjoiMjAyNiJ9_-x=",
    });
    render(await TenantPage(props()));
    const more = screen.getByRole("link", { name: "Load more" });
    expect(more).toHaveAttribute(
      "href",
      `/app/tenants/${TENANT}?tab=companies&cursor=eyJjIjoiMjAyNiJ9_-x%3D`,
    );
    expect(
      screen.queryByRole("link", { name: /first page/i }),
    ).not.toBeInTheDocument();
  });

  it("no Load more on the last page", async () => {
    render(await TenantPage(props()));
    expect(
      screen.queryByRole("link", { name: "Load more" }),
    ).not.toBeInTheDocument();
  });

  it("passes the cursor from the URL to the API and offers a way back to page one", async () => {
    render(
      await TenantPage(props({ query: { tab: "contacts", cursor: "CUR" } })),
    );
    expect(fetchPage).toHaveBeenCalledWith("tok", TENANT, "contacts", "CUR");
    expect(screen.getByRole("link", { name: /first page/i })).toHaveAttribute(
      "href",
      `/app/tenants/${TENANT}?tab=contacts`,
    );
  });

  it("ignores an absurdly long cursor instead of forwarding it", async () => {
    render(await TenantPage(props({ query: { cursor: "x".repeat(5000) } })));
    expect(fetchPage).toHaveBeenCalledWith("tok", TENANT, "companies", null);
  });

  it("urls carry only the tab and the opaque cursor: no names, e-mails or search terms", async () => {
    fetchPage.mockResolvedValue({ ...PAGES.contacts, nextCursor: "CUR" });
    const { container } = render(
      await TenantPage(props({ query: { tab: "contacts" } })),
    );
    const hrefs = [...container.querySelectorAll("a")].map(
      (a) => a.getAttribute("href") ?? "",
    );
    for (const href of hrefs) {
      expect(href).not.toMatch(/pat|example\.test|q=|search|name/i);
    }
  });

  // -------------------------------------------------------------------- empty and error states
  it.each(["companies", "contacts", "products", "leads", "opportunities"])(
    "says so when %s is empty",
    async (tab) => {
      fetchPage.mockResolvedValue({ entity: tab, items: [], nextCursor: null });
      render(await TenantPage(props({ query: { tab } })));
      expect(
        screen.getByText(new RegExp(`No ${tab} yet`, "i")),
      ).toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
    },
  );

  it("an empty page reached with a cursor says there is nothing more", async () => {
    fetchPage.mockResolvedValue({
      entity: "companies",
      items: [],
      nextCursor: null,
    });
    render(await TenantPage(props({ query: { cursor: "CUR" } })));
    expect(screen.getByText(/no more records/i)).toBeInTheDocument();
  });

  it("API down for the tables: a clear error and NO table, no placeholder rows", async () => {
    fetchPage.mockRejectedValue(
      new ApiRequestError(503, "api_unreachable", "The API is unreachable."),
    );
    render(await TenantPage(props()));
    expect(screen.getByRole("alert")).toHaveTextContent(/could not load/i);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText("Acme Silks")).not.toBeInTheDocument();
  });

  it("API down for the workspace itself: an error, not the not-found page", async () => {
    fetchTenant.mockRejectedValue(
      new ApiRequestError(503, "api_unreachable", "The API is unreachable."),
    );
    render(await TenantPage(props()));
    expect(screen.getByRole("alert")).toHaveTextContent(/could not load/i);
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("a malformed API payload is an error, never rendered", async () => {
    const { ApiContractError } = await import("@/lib/api/client");
    fetchPage.mockRejectedValue(new ApiContractError("bad"));
    render(await TenantPage(props()));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  // ------------------------------------------------------------------------------- the create form
  it.each(["owner", "admin", "sales"])(
    "shows the create form to a %s",
    async (role) => {
      fetchTenant.mockResolvedValue(tenant(role));
      render(await TenantPage(props()));
      expect(
        screen.getByRole("form", { name: "Create company" }),
      ).toBeInTheDocument();
    },
  );

  it("hides the create form from a viewer (the API would refuse anyway)", async () => {
    fetchTenant.mockResolvedValue(tenant("viewer"));
    render(await TenantPage(props()));
    expect(
      screen.queryByRole("form", { name: "Create company" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/create a company/i)).not.toBeInTheDocument();
  });

  it("generates the form id once per render, on the server", async () => {
    const randomUUID = vi.fn(() => FORM_ID);
    vi.stubGlobal("crypto", { randomUUID });
    render(await TenantPage(props()));
    expect(randomUUID).toHaveBeenCalledTimes(1);
    const hidden = document.querySelector(
      'input[name="id"]',
    ) as HTMLInputElement;
    expect(hidden.value).toBe(FORM_ID);
  });

  it("the page itself never makes a write", async () => {
    render(await TenantPage(props()));
    // no mutation helper exists on the mocked client surface used by the page
    expect(fetchTenant).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});
