import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ApiAuthError,
  ApiContractError,
  ApiRequestError,
  createTenant,
  fetchMe,
  parseMe,
  parseTenantDetail,
} from "./client";

const ME = {
  user_id: "11111111-1111-1111-1111-111111111111",
  memberships: [
    {
      role: "owner",
      tenant: {
        id: "22222222-2222-2222-2222-222222222222",
        name: "Acme",
        slug: "acme-silks",
      },
    },
  ],
};

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

describe("api client", () => {
  const original = globalThis.fetch;
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "http://api.test/");
  });
  afterEach(() => {
    globalThis.fetch = original;
    vi.unstubAllEnvs();
  });

  it("sends the caller's bearer token to /v1/me, uncached, and parses the result", async () => {
    const fetchMock = respond(200, ME);
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await expect(fetchMe("user-token")).resolves.toEqual(ME);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("http://api.test/v1/me");
    expect(init.cache).toBe("no-store");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer user-token",
    );
  });

  it("maps 401 to ApiAuthError", async () => {
    globalThis.fetch = respond(401, {
      error: { code: "unauthorized", message: "x" },
    }) as unknown as typeof fetch;
    await expect(fetchMe("t")).rejects.toBeInstanceOf(ApiAuthError);
  });

  it("surfaces the API error code and status", async () => {
    globalThis.fetch = respond(409, {
      error: { code: "slug_unavailable", message: "taken" },
    }) as unknown as typeof fetch;
    const error = await createTenant("t", "Acme", "acme-silks").catch((e) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ status: 409, code: "slug_unavailable" });
  });

  it("treats an unreachable API as an error, not an empty result", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(fetchMe("t")).rejects.toMatchObject({
      status: 503,
      code: "api_unreachable",
    });
  });

  it("posts the new tenant as JSON", async () => {
    const fetchMock = respond(200, {
      id: "i",
      name: "Acme",
      slug: "acme-silks",
      role: "owner",
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await createTenant("t", "Acme", "acme-silks");
    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      name: "Acme",
      slug: "acme-silks",
    });
  });

  it("falls back to localhost only outside production", () => {
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "");
    vi.stubEnv("NODE_ENV", "production");
    globalThis.fetch = respond(200, ME) as unknown as typeof fetch;
    return expect(fetchMe("t")).rejects.toThrow(/required in production/);
  });
});

describe("response validation (the API is not blindly trusted)", () => {
  it.each([
    null,
    "nope",
    {},
    { user_id: 1, memberships: [] },
    { user_id: "u", memberships: "x" },
    {
      user_id: "u",
      memberships: [{ role: "superuser", tenant: ME.memberships[0].tenant }],
    },
    {
      user_id: "u",
      memberships: [{ role: "owner", tenant: { id: 1, name: "n", slug: "s" } }],
    },
    { user_id: "u", memberships: [{ role: "owner" }] },
  ])("parseMe rejects %j", (json) => {
    expect(() => parseMe(json)).toThrow(ApiContractError);
  });

  it("parseMe drops unexpected extra fields", () => {
    const parsed = parseMe({
      ...ME,
      injected: "<script>",
      memberships: [{ ...ME.memberships[0], x: 1 }],
    });
    expect(parsed).toEqual(ME);
  });

  it("parseTenantDetail rejects a bad role", () => {
    expect(() =>
      parseTenantDetail({ id: "i", name: "n", slug: "s", role: "god" }),
    ).toThrow(ApiContractError);
  });
});
