import { afterEach, describe, expect, it, vi } from "vitest";

import { parseSearch, searchRecords } from "./search";

const T = "11111111-1111-4111-8111-111111111111";
const ID = "55555555-5555-4555-8555-555555555555";
afterEach(() => vi.unstubAllGlobals());
const stub = (status: number, body: unknown) => {
  const f = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", f);
  return f;
};

describe("C1's records search (docs/contracts/search.md)", () => {
  it("reads the groups strictly: known kinds, real ids, a title; five per kind at most", () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ id: `55555555-5555-4555-8555-55555555555${i}`, title: `Lead ${i}`, sub: null }));
    const out = parseSearch({ groups: [{ kind: "lead", items: [{ id: ID, title: " Anjali Boutique ", sub: "Hyderabad" }, { id: "nope", title: "x" }, { id: ID, title: "" }] }, { kind: "invoice", items: [{ id: ID, title: "x" }] }, { kind: "quote", items: many }] });
    expect(out[0]).toEqual({ kind: "lead", id: ID, title: "Anjali Boutique", sub: "Hyderabad" });
    expect(out.filter((i) => i.kind === "quote")).toHaveLength(5);
    expect(out).toHaveLength(6);
    expect(() => parseSearch({ items: [] })).toThrow();
  });
  it("asks with the person's token, only for 2 to 80 characters; a server without the route yet answers nothing", async () => {
    const f = stub(200, { groups: [{ kind: "lead", items: [{ id: ID, title: "Anjali", sub: null }] }] });
    expect(await searchRecords("tok", T, "an")).toHaveLength(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toMatch(new RegExp(`/v1/tenants/${T}/search\\?q=an$`));
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer tok");
    expect(await searchRecords("tok", T, "a")).toEqual([]);
    expect(await searchRecords("tok", T, "x".repeat(81))).toEqual([]);
    expect(f).toHaveBeenCalledTimes(1);
    stub(404, { error: { code: "not_found", message: "no" } });
    expect(await searchRecords("tok", T, "anjali")).toEqual([]);
    await expect(searchRecords("tok", "not-a-tenant", "anjali")).rejects.toThrow();
  });
});
