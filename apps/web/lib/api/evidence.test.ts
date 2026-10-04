import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiContractError, ApiRequestError } from "./client";
import {
  createEvidence,
  EVIDENCE_KINDS,
  SYSTEM_EVIDENCE_KINDS,
  EVIDENCE_PAGE_SIZE,
  fetchEvidencePage,
  isCleanText,
  KINDS_ARE_EXHAUSTIVE,
  parseEvidencePage,
  referenceText,
  validateEvidenceForm,
} from "./evidence";

const TENANT = "22222222-2222-2222-2222-222222222222";
const TARGET = "44444444-4444-4444-4444-444444444444";

const ITEM = {
  id: "55555555-5555-5555-5555-555555555555",
  company_id: TARGET,
  lead_id: null,
  claim_id: null,
  stance: null,
  created_by: null,
  created_via: "manual",
  created_at: "2026-01-01T00:00:00+00:00",
  archived_at: null,
  evidence: {
    id: "66666666-6666-6666-6666-666666666666",
    kind: "web_page",
    provider: "manual",
    url: "https://example.test/a",
    reference: "doc:abc-1",
    snippet: "line one\nline two",
    retrieved_at: "2026-01-02T03:04:05+00:00",
    published_at: "2026-01-01T00:00:00+00:00",
    created_by: null,
    created_via: "agent",
    created_at: "2026-01-02T03:04:06+00:00",
    archived_at: null,
  },
};

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

describe("parseEvidencePage", () => {
  it("keeps exactly the fields the page shows", () => {
    const page = parseEvidencePage({ items: [ITEM], next_cursor: "abc" });
    expect(page.nextCursor).toBe("abc");
    expect(page.items[0]).toEqual({
      linkId: ITEM.id,
      kind: "web_page",
      provider: "manual",
      url: "https://example.test/a",
      reference: "doc:abc-1",
      snippet: "line one\nline two",
      retrievedAt: "2026-01-02T03:04:05+00:00",
      publishedAt: "2026-01-01T00:00:00+00:00",
      createdVia: "agent",
    });
  });

  it("accepts nulls for the optional fields and an empty page", () => {
    const sparse = {
      ...ITEM,
      evidence: {
        ...ITEM.evidence,
        url: null,
        snippet: null,
        published_at: null,
      },
    };
    const page = parseEvidencePage({ items: [sparse], next_cursor: null });
    expect(page.items[0]).toMatchObject({
      url: null,
      snippet: null,
      publishedAt: null,
    });
    expect(parseEvidencePage({ items: [], next_cursor: null }).items).toEqual(
      [],
    );
  });

  it.each([
    ["not an object", "x"],
    ["no items", { next_cursor: null }],
    ["items not an array", { items: {}, next_cursor: null }],
    ["a bad cursor", { items: [], next_cursor: 5 }],
    ["an item that is not an object", { items: ["x"], next_cursor: null }],
    ["an item with no evidence", { items: [{ id: "x" }], next_cursor: null }],
    [
      "an unknown kind",
      {
        items: [{ ...ITEM, evidence: { ...ITEM.evidence, kind: "pigeon" } }],
        next_cursor: null,
      },
    ],
    [
      "an unknown origin",
      {
        items: [
          { ...ITEM, evidence: { ...ITEM.evidence, created_via: "robot" } },
        ],
        next_cursor: null,
      },
    ],
    [
      "a url of the wrong type",
      {
        items: [{ ...ITEM, evidence: { ...ITEM.evidence, url: 5 } }],
        next_cursor: null,
      },
    ],
    [
      "a missing retrieved_at",
      {
        items: [
          {
            ...ITEM,
            evidence: { ...ITEM.evidence, retrieved_at: undefined },
          },
        ],
        next_cursor: null,
      },
    ],
  ])("rejects %s", (_label, json) => {
    expect(() => parseEvidencePage(json)).toThrow(ApiContractError);
  });

  it("a contract error never carries the offending value", () => {
    try {
      parseEvidencePage({
        items: [
          {
            ...ITEM,
            evidence: {
              ...ITEM.evidence,
              kind: "Canary Zq91",
              url: "https://canary.zq91.example",
            },
          },
        ],
        next_cursor: null,
      });
    } catch (error) {
      expect(String(error)).not.toMatch(/canary|zq91/i);
    }
  });
});

describe("fetchEvidencePage / createEvidence", () => {
  const original = globalThis.fetch;
  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "http://api.test"));
  afterEach(() => {
    globalThis.fetch = original;
    vi.unstubAllEnvs();
  });

  it.each(["companies", "leads"] as const)(
    "lists %s evidence from OUR API with the user's token",
    async (target) => {
      const fetchMock = respond(200, { items: [ITEM], next_cursor: null });
      globalThis.fetch = fetchMock as unknown as typeof fetch;
      const page = await fetchEvidencePage(
        "user-token",
        TENANT,
        target,
        TARGET,
      );
      expect(page.items).toHaveLength(1);
      const [url, init] = fetchMock.mock.calls[0] as unknown as [
        string,
        RequestInit,
      ];
      expect(url).toBe(
        `http://api.test/v1/tenants/${TENANT}/${target}/${TARGET}/evidence?limit=${EVIDENCE_PAGE_SIZE}`,
      );
      expect((init.headers as Record<string, string>).Authorization).toBe(
        "Bearer user-token",
      );
    },
  );

  it("passes the opaque cursor through, URL-encoded", async () => {
    const fetchMock = respond(200, { items: [], next_cursor: null });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await fetchEvidencePage("t", TENANT, "companies", TARGET, "a+b/c=");
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toContain(
      "cursor=a%2Bb%2Fc%3D",
    );
  });

  it("refuses malformed ids before any request", async () => {
    const fetchMock = respond(200, {});
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await expect(
      fetchEvidencePage("t", "../me", "companies", TARGET),
    ).rejects.toBeInstanceOf(ApiContractError);
    await expect(
      fetchEvidencePage("t", TENANT, "companies", "x/../y"),
    ).rejects.toBeInstanceOf(ApiContractError);
    await expect(
      createEvidence("t", TENANT, "leads", "nope", {
        id: TARGET,
        kind: "note",
        reference: "doc:x1",
      }),
    ).rejects.toBeInstanceOf(ApiContractError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a 404 stays a 404 request error (the page turns it into not-found)", async () => {
    globalThis.fetch = respond(404, {
      error: { code: "not_found", message: "Not found." },
    }) as unknown as typeof fetch;
    await expect(
      fetchEvidencePage("t", TENANT, "companies", TARGET),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("a malformed body is an error, not data", async () => {
    globalThis.fetch = respond(200, {
      items: "nope",
    }) as unknown as typeof fetch;
    await expect(
      fetchEvidencePage("t", TENANT, "companies", TARGET),
    ).rejects.toBeInstanceOf(ApiContractError);
  });

  it("creates with exactly the given fields and the user's token", async () => {
    const fetchMock = respond(201, ITEM);
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await createEvidence("user-token", TENANT, "companies", TARGET, {
      id: ITEM.evidence.id,
      kind: "web_page",
      url: "https://example.test/a",
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      `http://api.test/v1/tenants/${TENANT}/companies/${TARGET}/evidence`,
    );
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      id: ITEM.evidence.id,
      kind: "web_page",
      url: "https://example.test/a",
    });
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer user-token",
    );
  });

  it("surfaces an API error as an ApiRequestError with the status", async () => {
    globalThis.fetch = respond(409, {
      error: { code: "conflict", message: "x" },
    }) as unknown as typeof fetch;
    await expect(
      createEvidence("t", TENANT, "companies", TARGET, {
        id: TARGET,
        kind: "note",
        reference: "doc:x1",
      }),
    ).rejects.toBeInstanceOf(ApiRequestError);
  });
});

describe("kinds", () => {
  it("offers every kind the contract knows", () => {
    expect(KINDS_ARE_EXHAUSTIVE).toBe(true);
    expect([...EVIDENCE_KINDS].sort()).toEqual(
      ["document", "email", "listing", "note", "registry", "web_page"].sort(),
    );
    // import_batch is written by the lead import only: the form never offers it
    expect([...EVIDENCE_KINDS]).not.toContain("import_batch");
    expect([...SYSTEM_EVIDENCE_KINDS]).toEqual(["import_batch"]);
  });
});

describe("isCleanText", () => {
  it.each([
    0x0, 0x1, 0x8, 0xb, 0xc, 0xe, 0x1f, 0x7f, 0x85, 0x9f, 0x200b, 0x2028,
    0x2029, 0x202a, 0x202e, 0x2060, 0x2064, 0x2066, 0x2069, 0xfeff, 0xe0000,
    0xe0020, 0xe007f,
  ])("rejects U+%s", (cp) => {
    expect(isCleanText(`a${String.fromCodePoint(cp)}b`)).toBe(false);
  });

  it.each([
    0x9, 0xa, 0xd, 0x20, 0xa0, 0xad, 0x200c, 0x200d, 0x200e, 0x200f, 0x2065,
    0xe0080, 0x1f600,
  ])("accepts U+%s", (cp) => {
    expect(isCleanText(`a${String.fromCodePoint(cp)}b`)).toBe(true);
  });

  it("accepts Indic, Persian and Arabic text with joiners", () => {
    for (const text of [
      "क्‍ष रेशमी साड़ी",
      "می‌خواهم",
      "తెలుగు పట్టు చీర",
      "مرحبا",
    ])
      expect(isCleanText(text)).toBe(true);
  });
});

describe("validateEvidenceForm", () => {
  const base = {
    kind: "web_page",
    url: "https://example.test/a",
    reference: "",
    snippet: "",
    publishedDate: "",
  };
  const NOW = new Date("2026-10-04T12:00:00Z");

  it("accepts a URL alone, a reference alone, or both", () => {
    expect(validateEvidenceForm(base, NOW)).toEqual({
      value: { kind: "web_page", url: "https://example.test/a" },
    });
    expect(
      validateEvidenceForm({ ...base, url: "", reference: "doc:abc-1" }, NOW),
    ).toEqual({ value: { kind: "web_page", reference: "doc:abc-1" } });
    expect(
      validateEvidenceForm(
        { ...base, reference: "doc:abc-1", snippet: "text" },
        NOW,
      ),
    ).toEqual({
      value: {
        kind: "web_page",
        url: "https://example.test/a",
        reference: "doc:abc-1",
        snippet: "text",
      },
    });
  });

  it("turns the published date into midnight UTC", () => {
    expect(
      validateEvidenceForm({ ...base, publishedDate: "2026-10-04" }, NOW),
    ).toEqual({
      value: {
        kind: "web_page",
        url: "https://example.test/a",
        published_at: "2026-10-04T00:00:00Z",
      },
    });
  });

  it.each([
    ["no url and no reference", { url: "", reference: "" }],
    ["an unknown kind", { kind: "pigeon" }],
    ["javascript:", { url: "javascript:alert(1)" }],
    ["data:", { url: "data:text/html;base64,AAAA" }],
    ["ftp:", { url: "ftp://example.test/x" }],
    ["userinfo", { url: "https://user:pw@example.test/" }],
    ["a space in the url", { url: "https://example.test/a b" }],
    [
      "a url that is too long",
      { url: `https://example.test/${"a".repeat(2100)}` },
    ],
    ["a too-short url", { url: "http://" }],
    ["a bad reference", { url: "", reference: "not a ref" }],
    ["an uppercase reference prefix", { url: "", reference: "DOC:abc" }],
    ["a snippet that is too long", { snippet: "s".repeat(1001) }],
    ["a zero-width space in the snippet", { snippet: "a​b" }],
    ["a tag character in the url", { url: "https://example.test/\u{e0020}" }],
    ["a bidi override in the reference", { url: "", reference: "doc:a‮b" }],
    ["a malformed date", { publishedDate: "04/10/2026" }],
    ["an impossible date", { publishedDate: "2026-13-45" }],
    ["a date in the future", { publishedDate: "2026-10-05" }],
  ])("rejects %s with a short message", (_label, over) => {
    const result = validateEvidenceForm({ ...base, ...over }, NOW);
    expect("error" in result).toBe(true);
  });

  it("an error never repeats what was typed", () => {
    const typed = "canary-zq91-nope";
    for (const over of [
      { url: `javascript:${typed}` },
      { url: "", reference: typed },
      { snippet: `${typed}​` },
      { publishedDate: typed },
    ]) {
      const result = validateEvidenceForm({ ...base, ...over }, NOW);
      expect(JSON.stringify(result)).not.toMatch(/canary|zq91/i);
    }
  });
});


describe("referenceText", () => {
  const RUN = "77ad4d19-79ca-535a-8af4-ad6be59d49d1";
  it("shows an agent note's run as a short, readable label", () => {
    expect(referenceText({ provider: "agent.selftest", reference: `run:${RUN}` })).toBe("Agent note (run 77ad4d19)");
  });
  it("leaves every other reference alone, including a person's lookalike", () => {
    expect(referenceText({ provider: "manual", reference: `run:${RUN}` })).toBe(`run:${RUN}`);
    expect(referenceText({ provider: "agent.selftest", reference: "doc:abc-1" })).toBe("doc:abc-1");
    expect(referenceText({ provider: "agent.selftest", reference: "run:not-a-uuid" })).toBe("run:not-a-uuid");
    expect(referenceText({ provider: "manual", reference: null })).toBe("");
  });
});
