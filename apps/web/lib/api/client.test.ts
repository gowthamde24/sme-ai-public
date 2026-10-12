import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ApiAuthError,
  ApiContractError,
  ApiRequestError,
  apiDownloadRequest,
  apiUploadRequest,
  createTenant,
  fetchMe,
  parseMe,
  parseTenantDetail,
  refusal,
  retryAfterSeconds,
  suggestedFilename,
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

  it("carries a closed reason code when the API gives one, and only a string", async () => {
    globalThis.fetch = respond(409, {
      error: { code: "order_event_refused", message: "x", reason: "ADVANCE_NOT_PAID" },
    }) as unknown as typeof fetch;
    expect(await createTenant("t", "Acme", "acme-silks").catch((e) => e)).toMatchObject({ code: "order_event_refused", reason: "ADVANCE_NOT_PAID" });
    globalThis.fetch = respond(409, { error: { code: "c", message: "x", reason: { nested: 1 } } }) as unknown as typeof fetch;
    expect((await createTenant("t", "Acme", "acme-silks").catch((e) => e)).reason).toBeUndefined();
    globalThis.fetch = respond(409, { error: { code: "c", message: "x" } }) as unknown as typeof fetch;
    expect((await createTenant("t", "Acme", "acme-silks").catch((e) => e)).reason).toBeUndefined();
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

describe("a file as the body of a request (the catalogue's photos)", () => {
  const original = globalThis.fetch;
  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "http://api.test"));
  afterEach(() => {
    globalThis.fetch = original;
    vi.unstubAllEnvs();
  });

  it("sends the bytes as they are with their own type and the person's token, and returns the JSON answer", async () => {
    const fetchMock = respond(200, { ok: 1 });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const bytes = new ArrayBuffer(4);
    await expect(apiUploadRequest("/v1/x", "tok", bytes, "image/webp")).resolves.toEqual({ ok: 1 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://api.test/v1/x");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(bytes);
    expect(init.headers).toEqual({ "Content-Type": "image/webp", Authorization: "Bearer tok" });
  });

  it("judges the status like every other request: 401 is the session, a refusal keeps only the API's code, a dead API is 503", async () => {
    globalThis.fetch = respond(401, {}) as unknown as typeof fetch;
    await expect(apiUploadRequest("/v1/x", "tok", new Blob(["x"]), "image/png")).rejects.toBeInstanceOf(ApiAuthError);
    globalThis.fetch = respond(413, { error: { code: "photo_too_large", message: "That photo is bigger than 5 MB." } }) as unknown as typeof fetch;
    await expect(apiUploadRequest("/v1/x", "tok", new Blob(["x"]), "image/png")).rejects.toMatchObject({ status: 413, code: "photo_too_large" });
    globalThis.fetch = vi.fn(async () => {
      throw new Error("down");
    }) as unknown as typeof fetch;
    await expect(apiUploadRequest("/v1/x", "tok", new Blob(["x"]), "image/png")).rejects.toMatchObject({ status: 503, code: "api_unreachable" });
  });
});

describe("a refusal from the rate limiter and the size ceiling (job CC)", () => {
  const original = globalThis.fetch;
  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "http://api.test"));
  afterEach(() => {
    globalThis.fetch = original;
    vi.unstubAllEnvs();
  });

  it("a 429 carries the seconds of its Retry-After header, and its code even though the API's body is a plain string", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ error: "rate_limited" }), { status: 429, headers: { "Retry-After": "42" } })) as unknown as typeof fetch;
    const error = await fetchMe("tok").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ status: 429, code: "rate_limited", retryAfter: 42 });
  });
  it("a Retry-After that is a date, negative, zero or absurd is not used", () => {
    expect(retryAfterSeconds("Wed, 21 Oct 2026 07:28:00 GMT")).toBeUndefined();
    expect(retryAfterSeconds("-5")).toBeUndefined();
    expect(retryAfterSeconds("0")).toBeUndefined();
    expect(retryAfterSeconds("999999")).toBeUndefined();
    expect(retryAfterSeconds(null)).toBeUndefined();
    expect(retryAfterSeconds("30")).toBe(30);
  });
  it("a 429 of the one error shape of job CD carries its seconds in the body too; the header wins when both are there", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ error: { code: "rate_limited", message: "Too many requests.", retry_after: 17, request_id: "abc" } }), { status: 429 })) as unknown as typeof fetch;
    await expect(fetchMe("tok")).rejects.toMatchObject({ status: 429, code: "rate_limited", retryAfter: 17 });
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ error: { code: "rate_limited", message: "x", retry_after: 17, request_id: "abc" } }), { status: 429, headers: { "Retry-After": "5" } })) as unknown as typeof fetch;
    await expect(fetchMe("tok")).rejects.toMatchObject({ retryAfter: 5 });
  });
  it("a 429 with no body at all is still rate_limited", async () => {
    globalThis.fetch = vi.fn(async () => new Response("", { status: 429 })) as unknown as typeof fetch;
    await expect(fetchMe("tok")).rejects.toMatchObject({ status: 429, code: "rate_limited" });
  });
  it("a body over the ceiling is payload_too_large, from the API's plain string", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ error: "payload_too_large" }), { status: 413 })) as unknown as typeof fetch;
    await expect(apiUploadRequest("/v1/x", "tok", new ArrayBuffer(1), "text/csv")).rejects.toMatchObject({ status: 413, code: "payload_too_large" });
  });
  it("a plain-string error that is not a closed word is not trusted as a code", () => {
    expect(refusal(500, { error: "Traceback (most recent call last)" }).code).toBe("http_error");
    expect(refusal(500, { error: { code: "boom", message: "fixed" } })).toMatchObject({ code: "boom", message: "fixed" });
  });
  it("a download is bytes with the file name and the few headers the screen shows; anything else the API sends is dropped", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="accounts-2026-09.zip"', "X-Export-Sales": "4", "X-Export-Payments": "2", "X-Secret": "no" } }),
    ) as unknown as typeof fetch;
    const file = await apiDownloadRequest("/v1/x", "tok", { a: 1 });
    expect(new Uint8Array(file.bytes)).toEqual(new Uint8Array([1, 2, 3]));
    expect(file.filename).toBe("accounts-2026-09.zip");
    expect(file.headers).toEqual({ "x-export-sales": "4", "x-export-payments": "2" });
  });
  it("a file name that is not plain is not used", () => {
    expect(suggestedFilename('attachment; filename="../../etc/passwd"')).toBeNull();
    expect(suggestedFilename(null)).toBeNull();
    expect(suggestedFilename("attachment; filename=a.csv")).toBe("a.csv");
  });
  it("a refused download is the same error as any other call, and a rejected session is an auth error", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ error: { code: "mfa_required", message: "x" } }), { status: 403 })) as unknown as typeof fetch;
    await expect(apiDownloadRequest("/v1/x", "tok", {})).rejects.toMatchObject({ status: 403, code: "mfa_required" });
    globalThis.fetch = vi.fn(async () => new Response("", { status: 401 })) as unknown as typeof fetch;
    await expect(apiDownloadRequest("/v1/x", "tok", {})).rejects.toBeInstanceOf(ApiAuthError);
  });
});
