import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { redirectMock, redirectTarget } from "@/test/helpers";

const requireUser = vi.fn();
const createCompany = vi.fn();
const revalidatePath = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (to: string) => redirectMock(to),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => revalidatePath(p),
}));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/crm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/crm")>()),
  createCompany: (...args: unknown[]) => createCompany(...args),
}));

import { createCompanyAction } from "./actions";

const TENANT = "22222222-2222-2222-2222-222222222222";
const FORM_ID = "33333333-3333-3333-3333-333333333333";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}
const OK = { id: FORM_ID, name: "Acme Silks", type: "customer" };

describe("createCompanyAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUser.mockResolvedValue({ id: "u", email: "e", accessToken: "tok" });
    createCompany.mockResolvedValue(undefined);
  });

  it("creates the company with the form's id and returns to the companies tab", async () => {
    const target = await redirectTarget(() =>
      createCompanyAction(
        TENANT,
        undefined,
        form({
          ...OK,
          website: " https://acme.example ",
          country: "IN",
          city: "Chennai",
          industry: "Silk",
        }),
      ),
    );
    expect(target).toBe(`/app/tenants/${TENANT}?tab=companies`);
    expect(createCompany).toHaveBeenCalledWith("tok", TENANT, {
      id: FORM_ID,
      name: "Acme Silks",
      type: "customer",
      website: "https://acme.example",
      country: "IN",
      city: "Chennai",
      industry: "Silk",
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${TENANT}`);
  });

  it("omits empty optional fields and defaults the type", async () => {
    await redirectTarget(() =>
      createCompanyAction(
        TENANT,
        undefined,
        form({ id: FORM_ID, name: "Bare", website: "  " }),
      ),
    );
    expect(createCompany).toHaveBeenCalledWith("tok", TENANT, {
      id: FORM_ID,
      name: "Bare",
      type: "prospect",
    });
  });

  it("authenticates first: no session, no API call", async () => {
    requireUser.mockImplementation(() => redirectMock("/login"));
    expect(
      await redirectTarget(() =>
        createCompanyAction(TENANT, undefined, form(OK)),
      ),
    ).toBe("/login");
    expect(createCompany).not.toHaveBeenCalled();
  });

  it("a double submit is a safe retry: the SAME id is sent both times", async () => {
    await redirectTarget(() =>
      createCompanyAction(TENANT, undefined, form(OK)),
    );
    await redirectTarget(() =>
      createCompanyAction(TENANT, undefined, form(OK)),
    );
    const ids = createCompany.mock.calls.map(
      (c) => (c[2] as { id: string }).id,
    );
    expect(ids).toEqual([FORM_ID, FORM_ID]);
  });

  it("an API 200 for the retry (same row) is a success like any other", async () => {
    createCompany.mockResolvedValue(undefined);
    expect(
      await redirectTarget(() =>
        createCompanyAction(TENANT, undefined, form(OK)),
      ),
    ).toContain("?tab=companies");
  });

  it.each([
    [403, "Your role cannot create companies."],
    [404, "This workspace is not available."],
    [
      409,
      "That form was already used for a different company. Reload the page and try again.",
    ],
    [422, "Check the values and try again."],
    [500, "Could not save the company. Try again."],
    [503, "Could not save the company. Try again."],
  ])(
    "maps API status %i to a short generic message",
    async (status, message) => {
      createCompany.mockRejectedValue(
        new ApiRequestError(
          status,
          "whatever_code",
          "RAW API TEXT with Canary Zq91",
        ),
      );
      const result = await createCompanyAction(TENANT, undefined, form(OK));
      expect(result).toEqual({ error: message });
    },
  );

  it("never echoes the raw API body, code, or the submitted values", async () => {
    const canary = "Canary Zq91 canary.zq91@example.test";
    createCompany.mockRejectedValue(
      new ApiRequestError(422, "duplicate_value", `The value ${canary} is bad`),
    );
    const result = await createCompanyAction(
      TENANT,
      undefined,
      form({ ...OK, name: canary }),
    );
    const text = JSON.stringify(result);
    expect(text).not.toMatch(/canary|zq91|duplicate_value/i);
  });

  it("API down (unreachable) is a generic retry message", async () => {
    createCompany.mockRejectedValue(
      new ApiRequestError(503, "api_unreachable", "The API is unreachable."),
    );
    expect(await createCompanyAction(TENANT, undefined, form(OK))).toEqual({
      error: "Could not save the company. Try again.",
    });
  });

  it("an unexpected exception is also generic", async () => {
    createCompany.mockRejectedValue(new Error("boom with Canary Zq91"));
    const result = await createCompanyAction(TENANT, undefined, form(OK));
    expect(JSON.stringify(result)).not.toMatch(/boom|canary/i);
  });

  it("a rejected session sends the user to /login", async () => {
    createCompany.mockRejectedValue(new ApiAuthError("expired"));
    expect(
      await redirectTarget(() =>
        createCompanyAction(TENANT, undefined, form(OK)),
      ),
    ).toBe("/login");
  });

  it.each([
    ["missing id", { name: "x" }],
    ["malformed id", { id: "not-a-uuid", name: "x" }],
    ["compact uuid", { id: FORM_ID.replaceAll("-", ""), name: "x" }],
    ["empty name", { id: FORM_ID, name: "   " }],
    ["name too long", { id: FORM_ID, name: "x".repeat(201) }],
    ["unknown type", { id: FORM_ID, name: "x", type: "investor" }],
    ["website too long", { id: FORM_ID, name: "x", website: "w".repeat(201) }],
    ["city too long", { id: FORM_ID, name: "x", city: "c".repeat(101) }],
  ])(
    "validates on the server before calling the API: %s",
    async (_label, values) => {
      const result = await createCompanyAction(TENANT, undefined, form(values));
      expect(result?.error).toBeTruthy();
      expect(createCompany).not.toHaveBeenCalled();
    },
  );

  it("refuses a malformed tenant id (it comes from the URL)", async () => {
    const result = await createCompanyAction("../me", undefined, form(OK));
    expect(result).toEqual({ error: "This workspace is not available." });
    expect(createCompany).not.toHaveBeenCalled();
  });

  it("ignores any extra form fields (no mass assignment)", async () => {
    await redirectTarget(() =>
      createCompanyAction(
        TENANT,
        undefined,
        form({ ...OK, created_by: "x", tenant_id: "y", archived_at: "z" }),
      ),
    );
    expect(
      Object.keys(createCompany.mock.calls[0][2] as object).sort(),
    ).toEqual(["id", "name", "type"]);
  });
});
