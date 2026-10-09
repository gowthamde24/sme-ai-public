import { describe, expect, it, vi } from "vitest";

import { getLang } from "./get-lang";

describe("getLang outside a request (workspace redesign, Batch 0 proof)", () => {
  it("answers English when next/headers has no request, with the REAL cookies() (no mock): page tests call pages directly", async () => {
    await expect(getLang()).resolves.toBe("en");
  });
});

describe("getLang inside a request", () => {
  it("reads sme_lang, ignores a value that is not a language", async () => {
    const jar = new Map<string, string>();
    vi.resetModules();
    vi.doMock("next/headers", () => ({ cookies: async () => ({ get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n) } : undefined) }) }));
    const { getLang: inRequest } = await import("./get-lang");
    expect(await inRequest()).toBe("en");
    jar.set("sme_lang", "te");
    expect(await inRequest()).toBe("te");
    jar.set("sme_lang", "xx");
    expect(await inRequest()).toBe("en");
    vi.doUnmock("next/headers");
  });
});
