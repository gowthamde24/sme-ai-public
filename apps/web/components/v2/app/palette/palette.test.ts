import { describe, expect, it } from "vitest";

import { paletteNames } from "./names";
import { ACTIONS, RECENT_MAX, addRecent, fold, matchItems, parseRecent, recordHref, type PaletteItem } from "./palette";

const B = "/app/tenants/11111111-1111-4111-8111-111111111111";
const ID = "55555555-5555-4555-8555-555555555555";
const item = (id: string, ...names: string[]): PaletteItem => ({ id, kind: "page", label: names[0], names, href: `${B}/${id}` });

describe("the command palette's items (owner, 6 Nov 2026)", () => {
  it("matches whatever the case, spaces or punctuation, a name that starts with the text first", () => {
    const items = [item("chats", "Customer chats"), item("customers", "Customers"), item("settings", "Settings")];
    expect(matchItems("cust", items).map((i) => i.id)).toEqual(["chats", "customers"]);
    expect(matchItems("CUSTOMER  chats!", items).map((i) => i.id)).toEqual(["chats"]);
    expect(matchItems("chats", items).map((i) => i.id)).toEqual(["chats"]);
    expect(matchItems("   ", items)).toEqual([]);
    expect(fold("Plan & usage")).toBe("planusage");
  });
  it("matches in every language of the app and in English (Telugu typing works)", () => {
    const { names } = paletteNames("en");
    const settings = item("settings", ...(names.settings ?? []));
    expect(names.settings?.[0]).toBe("Settings");
    const te = names.settings?.find((n) => /[ఀ-౿]/.test(n));
    expect(te).toBeTruthy();
    expect(matchItems(te!.slice(0, 3), [settings]).map((i) => i.id)).toEqual(["settings"]);
    expect(matchItems(te!.normalize("NFD"), [settings])).toHaveLength(1);
  });
  it("puts the person's own language first, and has a word for every action in it", () => {
    const te = paletteNames("te");
    expect(te.names.settings?.[0]).toMatch(/[ఀ-౿]/);
    expect(te.names.settings).toContain("Settings");
    for (const a of ACTIONS) expect(paletteNames("en").names[`action:${a.id}`]?.[0], a.id).toBeTruthy();
    expect(paletteNames("en").words["palette.ask"]).toContain("{text}");
  });
  it("routes a record by its kind and id only, never by an address the API wrote", () => {
    expect(recordHref(B, "lead", ID)).toBe(`${B}/leads/${ID}`);
    expect(recordHref(B, "customer", ID)).toBe(`${B}/companies/${ID}`);
    expect(recordHref(B, "order", ID)).toBe(`${B}/orders/${ID}`);
    expect(recordHref(B, "quote", ID)).toBe(`${B}/quotes/${ID}`);
    expect(recordHref(B, "student", ID)).toBe(`${B}/students/${ID}`);
    expect(recordHref(B, "invoice", ID)).toBeNull();
    expect(recordHref(B, "lead", "../../evil")).toBeNull();
    expect(recordHref(B, "lead", "https://evil.example/aaaaaaaaaaaaaaaaaaaaaaaaaa")).toBeNull();
  });
  it("Recent: newest first, five at most, never the same address twice, only this app's own addresses", () => {
    let list: { href: string; label: string }[] = [];
    for (let i = 0; i < 7; i++) list = addRecent(list, { href: `/app/x/${i}`, label: `P${i}` });
    expect(list).toHaveLength(RECENT_MAX);
    expect(list[0].label).toBe("P6");
    list = addRecent(list, { href: "/app/x/4", label: "P4 again" });
    expect(list.map((e) => e.href)).toEqual(["/app/x/4", "/app/x/6", "/app/x/5", "/app/x/3", "/app/x/2"]);
    expect(parseRecent(JSON.stringify([{ href: "https://evil.example", label: "x" }, { href: "/app/a", label: "A" }, { href: "/app/b" }]))).toEqual([{ href: "/app/a", label: "A" }]);
    expect(parseRecent("not json")).toEqual([]);
    expect(parseRecent(null)).toEqual([]);
    expect(parseRecent('{"a":1}')).toEqual([]);
  });
});
