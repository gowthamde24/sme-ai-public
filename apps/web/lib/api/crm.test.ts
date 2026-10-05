import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiContractError, ApiRequestError } from "./client";
import {
  createCompany,
  ENTITY_KEYS,
  fetchCompany,
  fetchLead,
  fetchPage,
  isCanonicalUuid,
  PAGE_SIZE,
  parsePage,
} from "./crm";

const TENANT = "22222222-2222-2222-2222-222222222222";
const ROW = {
  companies: {
    id: "a",
    name: "Acme",
    type: "customer",
    website: null,
    country: "IN",
    region: null,
    city: "Chennai",
    industry: null,
    tags: [],
    created_via: "manual",
    created_at: "2026-01-02T03:04:05+00:00",
    created_by: null,
    updated_at: "x",
    archived_at: null,
  },
  contacts: {
    id: "a",
    full_name: "Pat",
    email: "p@example.test",
    phone: null,
    job_title: null,
    company_id: null,
    email_consent: "granted",
    whatsapp_consent: "unknown",
    phone_consent: "withdrawn",
    suppressed_at: null,
    suppression_reason: null,
    created_via: "manual",
  },
  products: {
    id: "a",
    sku: "S-1",
    name: "Saree",
    unit: null,
    category: "silk",
    active: true,
    created_via: "import",
  },
  leads: {
    id: "a",
    company_id: null,
    status: "new",
    source: null,
    created_via: "manual",
    created_at: "2026-01-02T00:00:00+00:00",
  },
  opportunities: {
    id: "a",
    title: "Deal",
    status: "open",
    closed_at: null,
    created_via: "agent",
    created_at: "2026-01-02T00:00:00+00:00",
  },
} as const;

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

describe("fetchPage", () => {
  const original = globalThis.fetch;
  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "http://api.test"));
  afterEach(() => {
    globalThis.fetch = original;
    vi.unstubAllEnvs();
  });

  it.each(ENTITY_KEYS)(
    "requests %s from OUR API with the user's token",
    async (entity) => {
      const fetchMock = respond(200, {
        items: [ROW[entity]],
        next_cursor: null,
      });
      globalThis.fetch = fetchMock as unknown as typeof fetch;
      const page = await fetchPage("user-token", TENANT, entity);
      expect(page.entity).toBe(entity);
      expect(page.items).toHaveLength(1);

      const [url, init] = fetchMock.mock.calls[0] as unknown as [
        string,
        RequestInit,
      ];
      expect(url).toBe(
        `http://api.test/v1/tenants/${TENANT}/${entity}?limit=${PAGE_SIZE}`,
      );
      expect((init.headers as Record<string, string>).Authorization).toBe(
        "Bearer user-token",
      );
      expect(init.cache).toBe("no-store");
      expect(url).not.toContain("/rest/v1");
    },
  );

  it("passes the opaque cursor as an encoded query parameter", async () => {
    const fetchMock = respond(200, { items: [], next_cursor: null });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await fetchPage("t", TENANT, "contacts", "abc_-DEF=+/");
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toContain("cursor=abc_-DEF%3D%2B%2F");
  });

  it("returns the next cursor", async () => {
    globalThis.fetch = respond(200, {
      items: [],
      next_cursor: "NEXT",
    }) as unknown as typeof fetch;
    expect((await fetchPage("t", TENANT, "leads")).nextCursor).toBe("NEXT");
  });

  it("refuses a tenant id that is not a canonical uuid before any request", async () => {
    const fetchMock = respond(200, { items: [], next_cursor: null });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    for (const bad of ["x", "../me", `${TENANT}/../..`, "", `${TENANT}?x=1`]) {
      await expect(fetchPage("t", bad, "companies")).rejects.toBeInstanceOf(
        ApiContractError,
      );
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps 401 to ApiAuthError and other failures to ApiRequestError", async () => {
    globalThis.fetch = respond(401, {
      error: { code: "unauthorized", message: "x" },
    }) as unknown as typeof fetch;
    await expect(fetchPage("t", TENANT, "companies")).rejects.toBeInstanceOf(
      ApiAuthError,
    );
    globalThis.fetch = respond(404, {
      error: { code: "not_found", message: "Not found." },
    }) as unknown as typeof fetch;
    await expect(fetchPage("t", TENANT, "companies")).rejects.toMatchObject({
      status: 404,
    });
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(fetchPage("t", TENANT, "companies")).rejects.toMatchObject({
      status: 503,
      code: "api_unreachable",
    });
  });
});

describe("response validation: the API is not blindly trusted", () => {
  it.each([
    null,
    "x",
    {},
    { items: "nope", next_cursor: null },
    { items: [], next_cursor: 5 },
    { items: [null], next_cursor: null },
    { items: [{}], next_cursor: null },
  ])("rejects the page %j", (json) => {
    expect(() => parsePage("companies", json)).toThrow(ApiContractError);
  });

  it("rejects a row with a wrong-typed or unknown-enum field", () => {
    expect(() =>
      parsePage("companies", {
        items: [{ ...ROW.companies, name: 5 }],
        next_cursor: null,
      }),
    ).toThrow(ApiContractError);
    expect(() =>
      parsePage("companies", {
        items: [{ ...ROW.companies, type: "investor" }],
        next_cursor: null,
      }),
    ).toThrow(ApiContractError);
    expect(() =>
      parsePage("opportunities", {
        items: [{ ...ROW.opportunities, status: "maybe" }],
        next_cursor: null,
      }),
    ).toThrow(ApiContractError);
    expect(() =>
      parsePage("products", {
        items: [{ ...ROW.products, active: "yes" }],
        next_cursor: null,
      }),
    ).toThrow(ApiContractError);
  });

  it("drops fields the page does not show (e.g. tags, created_by)", () => {
    const page = parsePage("companies", {
      items: [ROW.companies],
      next_cursor: null,
    });
    expect(Object.keys(page.items[0]).sort()).toEqual(
      [
        "city",
        "country",
        "created_at",
        "created_via",
        "id",
        "industry",
        "name",
        "type",
        "website",
      ].sort(),
    );
  });
});

describe("createCompany", () => {
  const original = globalThis.fetch;
  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "http://api.test"));
  afterEach(() => {
    globalThis.fetch = original;
    vi.unstubAllEnvs();
  });

  it("posts to the tenant's companies endpoint with the client id", async () => {
    const fetchMock = respond(201, {});
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await createCompany("tok", TENANT, {
      id: "11111111-1111-1111-1111-111111111111",
      name: "Acme",
      type: "customer",
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(`http://api.test/v1/tenants/${TENANT}/companies`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      id: "11111111-1111-1111-1111-111111111111",
      name: "Acme",
      type: "customer",
    });
  });

  it("surfaces API status codes as ApiRequestError", async () => {
    globalThis.fetch = respond(409, {
      error: { code: "conflict", message: "x" },
    }) as unknown as typeof fetch;
    await expect(
      createCompany("t", TENANT, { id: "i", name: "n", type: "other" }),
    ).rejects.toBeInstanceOf(ApiRequestError);
  });
});

describe("isCanonicalUuid", () => {
  it("accepts only 8-4-4-4-12", () => {
    expect(isCanonicalUuid(TENANT)).toBe(true);
    expect(isCanonicalUuid(TENANT.toUpperCase())).toBe(true);
    for (const bad of [
      "",
      "x",
      TENANT.replaceAll("-", ""),
      `urn:uuid:${TENANT}`,
      ` ${TENANT}`,
      `${TENANT}\n`,
    ]) {
      expect(isCanonicalUuid(bad)).toBe(false);
    }
  });
});

describe("fetchCompany / fetchLead", () => {
  const original = globalThis.fetch;
  const ID = "44444444-4444-4444-4444-444444444444";
  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "http://api.test"));
  afterEach(() => {
    globalThis.fetch = original;
    vi.unstubAllEnvs();
  });

  it("reads one company from OUR API with the user's token", async () => {
    const fetchMock = respond(200, ROW.companies);
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const company = await fetchCompany("user-token", TENANT, ID);
    expect(company.name).toBe("Acme");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(`http://api.test/v1/tenants/${TENANT}/companies/${ID}`);
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer user-token",
    );
  });

  it("reads one lead", async () => {
    globalThis.fetch = respond(200, ROW.leads) as unknown as typeof fetch;
    expect((await fetchLead("t", TENANT, ID)).status).toBe("new");
  });

  it("refuses malformed ids before any request", async () => {
    const fetchMock = respond(200, ROW.companies);
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await expect(fetchCompany("t", "../me", ID)).rejects.toBeInstanceOf(
      ApiContractError,
    );
    await expect(fetchLead("t", TENANT, "x")).rejects.toBeInstanceOf(
      ApiContractError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a 404 stays a 404 and a malformed body is a contract error", async () => {
    globalThis.fetch = respond(404, {
      error: { code: "not_found", message: "Not found." },
    }) as unknown as typeof fetch;
    await expect(fetchCompany("t", TENANT, ID)).rejects.toMatchObject({
      status: 404,
    });
    globalThis.fetch = respond(200, { nope: 1 }) as unknown as typeof fetch;
    await expect(fetchCompany("t", TENANT, ID)).rejects.toBeInstanceOf(
      ApiContractError,
    );
    globalThis.fetch = respond(200, [1]) as unknown as typeof fetch;
    await expect(fetchLead("t", TENANT, ID)).rejects.toBeInstanceOf(
      ApiContractError,
    );
  });
});
