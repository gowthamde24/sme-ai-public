import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { redirectMock, redirectTarget } from "@/test/helpers";

const requireUser = vi.fn();
const createEvidence = vi.fn();
const revalidatePath = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (to: string) => redirectMock(to),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => revalidatePath(p),
}));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/evidence", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/evidence")>()),
  createEvidence: (...args: unknown[]) => createEvidence(...args),
}));

import { addEvidenceAction } from "./evidence-actions";

const TENANT = "22222222-2222-2222-2222-222222222222";
const TARGET = "44444444-4444-4444-4444-444444444444";
const FORM_ID = "33333333-3333-3333-3333-333333333333";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}
const OK = { id: FORM_ID, kind: "web_page", url: "https://example.test/a" };
const run = (
  values: Record<string, string> = OK,
  target = "companies" as const,
) => addEvidenceAction(TENANT, target, TARGET, undefined, form(values));

describe("addEvidenceAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUser.mockResolvedValue({ id: "u", email: "e", accessToken: "tok" });
    createEvidence.mockResolvedValue(undefined);
  });

  it("creates the evidence with the form's id and returns to the record", async () => {
    const target = await redirectTarget(() =>
      run({
        ...OK,
        url: "  https://example.test/a  ",
        reference: "doc:abc-1",
        snippet: " a quote ",
        published_at: "2026-01-02",
      }),
    );
    expect(target).toBe(`/app/tenants/${TENANT}/companies/${TARGET}`);
    expect(createEvidence).toHaveBeenCalledWith(
      "tok",
      TENANT,
      "companies",
      TARGET,
      {
        id: FORM_ID,
        kind: "web_page",
        url: "https://example.test/a",
        reference: "doc:abc-1",
        snippet: "a quote",
        published_at: "2026-01-02T00:00:00Z",
      },
    );
    expect(revalidatePath).toHaveBeenCalledWith(
      `/app/tenants/${TENANT}/companies/${TARGET}`,
    );
  });

  it("works for a lead too", async () => {
    const target = await redirectTarget(() => run(OK, "leads" as never));
    expect(target).toBe(`/app/tenants/${TENANT}/leads/${TARGET}`);
    expect(createEvidence.mock.calls[0][2]).toBe("leads");
  });

  it("sends only the fields that were filled in", async () => {
    await redirectTarget(() =>
      run({
        id: FORM_ID,
        kind: "note",
        url: "",
        reference: "doc:x1",
        snippet: " ",
      }),
    );
    expect(createEvidence.mock.calls[0][4]).toEqual({
      id: FORM_ID,
      kind: "note",
      reference: "doc:x1",
    });
  });

  it("authenticates first: no session, no API call", async () => {
    requireUser.mockImplementation(() => redirectMock("/login"));
    expect(await redirectTarget(() => run())).toBe("/login");
    expect(createEvidence).not.toHaveBeenCalled();
  });

  it("a double submit is a safe retry: the SAME id is sent both times", async () => {
    await redirectTarget(() => run());
    await redirectTarget(() => run());
    const ids = createEvidence.mock.calls.map(
      (c) => (c[4] as { id: string }).id,
    );
    expect(ids).toEqual([FORM_ID, FORM_ID]);
  });

  it.each([
    [403, "Your role cannot add evidence."],
    [404, "This record is not available."],
    [
      409,
      "That form was already used for different evidence. Reload the page and try again.",
    ],
    [422, "Check the values and try again."],
    [500, "Could not save the evidence. Try again."],
    [503, "Could not save the evidence. Try again."],
  ])(
    "maps API status %i to a short generic message",
    async (status, message) => {
      createEvidence.mockRejectedValue(
        new ApiRequestError(
          status,
          "whatever_code",
          "RAW API TEXT Canary Zq91",
        ),
      );
      expect(await run()).toEqual({ error: message });
    },
  );

  it("an archived record has its own short message", async () => {
    createEvidence.mockRejectedValue(
      new ApiRequestError(409, "archived", "This record is archived; x"),
    );
    expect(await run()).toEqual({
      error: "This record is archived, so it takes no new evidence.",
    });
  });

  it("never echoes the raw API text, the code or what was submitted", async () => {
    const canary = "Canary Zq91 https://canary.zq91.example/in/jane";
    for (const status of [403, 404, 409, 422, 500]) {
      createEvidence.mockRejectedValue(
        new ApiRequestError(
          status,
          "duplicate_value",
          `The value ${canary} is bad`,
        ),
      );
      const result = await run({
        ...OK,
        url: "https://canary.zq91.example/x",
        snippet: canary,
      });
      expect(JSON.stringify(result)).not.toMatch(
        /canary|zq91|duplicate_value/i,
      );
    }
    createEvidence.mockRejectedValue(new Error(`boom with ${canary}`));
    expect(JSON.stringify(await run())).not.toMatch(/boom|canary|zq91/i);
  });

  it("a rejected session sends the user to /login", async () => {
    createEvidence.mockRejectedValue(new ApiAuthError("expired"));
    expect(await redirectTarget(() => run())).toBe("/login");
  });

  it.each([
    ["missing id", { kind: "note", reference: "doc:x1" }],
    ["malformed id", { ...OK, id: "not-a-uuid" }],
    ["compact uuid", { ...OK, id: FORM_ID.replaceAll("-", "") }],
    ["unknown kind", { ...OK, kind: "pigeon" }],
    ["no kind", { id: FORM_ID, url: "https://example.test/a" }],
    [
      "neither url nor reference",
      { id: FORM_ID, kind: "note", snippet: "only text" },
    ],
    ["javascript: url", { ...OK, url: "javascript:alert(1)" }],
    ["credentials in the url", { ...OK, url: "https://u:p@example.test/" }],
    ["a long url", { ...OK, url: `https://example.test/${"a".repeat(2100)}` }],
    ["a bad reference", { id: FORM_ID, kind: "note", reference: "no good" }],
    ["a long snippet", { ...OK, snippet: "s".repeat(1001) }],
    ["a zero-width space", { ...OK, snippet: "a​b" }],
    ["a bad date", { ...OK, published_at: "soon" }],
    ["a future date", { ...OK, published_at: "2999-01-01" }],
  ])(
    "validates on the server before calling the API: %s",
    async (_label, values) => {
      const result = await run(values as Record<string, string>);
      expect(result?.error).toBeTruthy();
      expect(createEvidence).not.toHaveBeenCalled();
    },
  );

  it("refuses a malformed tenant or target id (they come from the URL)", async () => {
    for (const [tenant, target] of [
      ["../me", TARGET],
      [TENANT, "x/../y"],
    ]) {
      const result = await addEvidenceAction(
        tenant,
        "companies",
        target,
        undefined,
        form(OK),
      );
      expect(result).toEqual({ error: "This record is not available." });
    }
    expect(
      await addEvidenceAction(
        TENANT,
        "contacts" as never,
        TARGET,
        undefined,
        form(OK),
      ),
    ).toEqual({ error: "This record is not available." });
    expect(createEvidence).not.toHaveBeenCalled();
  });

  it("ignores any extra form fields (no mass assignment: provider, origin, tenant, archive)", async () => {
    await redirectTarget(() =>
      run({
        ...OK,
        provider: "agent.run",
        created_via: "agent",
        created_by: "x",
        tenant_id: "y",
        archived_at: "z",
        company_id: "w",
      }),
    );
    expect(
      Object.keys(createEvidence.mock.calls[0][4] as object).sort(),
    ).toEqual(["id", "kind", "url"]);
  });
});
